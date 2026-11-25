// Sol y Cerveza service worker: fast repeat visits and an app that opens
// offline, without ever pinning users to an old version.
//
// Built by serviceWorker.ts (vite.config.ts) into dist/sw.js, with the
// build's manifest prepended as `__SW_MANIFEST__`. A single script with no
// imports, so it runs as a classic worker everywhere. Strategies:
//
// - assets/*-<hash>.* : precached per build, cache-first (they never change).
//   Chunks only owner tools import (exifr) are cached on first use instead.
// - the page, data/terraces.json, data/buildings.json and data/trees.json
//   (and other unhashed files): network-first
//   with a short timeout; the cache only when offline, slow or the server
//   errors. A response that arrives after the timeout still updates the
//   cache, so the next load uses it.
// - OpenFreeMap (basemap): style and TileJSON network-first; tiles, glyphs
//   and sprites stale-while-revalidate. Capped by entries and age; opaque
//   responses are never stored.
// - Prices API: GET /v1/prices network-first. Other requests, and every
//   non-GET (POST /v1/changes and /v1/reports, owner mode's /v1/owner/*),
//   go straight to the network.
//
// docs/operations.md, "Offline and the service worker", has the kill switch.

import type { SwManifest } from './manifest.ts'

declare const self: ServiceWorkerGlobalScope
declare const __SW_MANIFEST__: SwManifest

const MANIFEST = __SW_MANIFEST__
const SCOPE = new URL(self.registration.scope)
const SHELL_URL = SCOPE.href
const ASSETS_PREFIX = new URL('assets/', SCOPE).href

const PREFIX = 'syc-'
const APP_PREFIX = `${PREFIX}app-`
/** This build's hashed assets. */
const APP_CACHE = `${APP_PREFIX}${MANIFEST.build}`
/** The page, the venue data and the other unhashed files; always revalidated. */
const PAGES_CACHE = `${PREFIX}pages-v1`
const BASEMAP_CACHE = `${PREFIX}basemap-v1`
const PRICES_CACHE = `${PREFIX}prices-v1`

/**
 * The data the map needs, seeded at install: the venues, the LiDAR
 * buildings and tree crowns the shadows are cast from (deployed from the
 * height-tiles branch, about 0.5 MB gzipped together) and the bridge mesh.
 */
const DATA_FILES = [
  'data/terraces.json',
  'data/buildings.json',
  'data/trees.json',
  'data/bridge-mesh.json',
]

/** How long to wait for the network before falling back to the cache. */
const NETWORK_TIMEOUT_MS = 3000

const BASEMAP_HOST = new URL(MANIFEST.basemapStyle).hostname
const BASEMAP_MAX_ENTRIES = 600
const BASEMAP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Header we add to stored basemap responses, to enforce the age cap. */
const STORED_AT = 'x-syc-stored-at'

const PRICES_URL = MANIFEST.pricesApi
  ? `${MANIFEST.pricesApi.replace(/\/+$/, '')}/v1/prices`
  : null

// --- Install: precache this build, seed the page and data ------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precacheAssets()
      await seed()
      await self.skipWaiting()
    })(),
  )
})

/** Hashed names are content-addressed: reuse any cached copy, fetch the rest. */
async function precacheAssets(): Promise<void> {
  const cache = await caches.open(APP_CACHE)
  await Promise.all(
    MANIFEST.assets.map(async (path) => {
      const url = new URL(path, SCOPE).href
      if (await cache.match(url)) return
      const cached = await caches.match(url)
      if (cached) return cache.put(url, cached)
      const response = await fetch(url)
      // A missing asset fails the install; the next navigation retries.
      if (!response.ok) throw new Error(`precache ${url}: ${response.status}`)
      return cache.put(url, response)
    }),
  )
}

/**
 * So the app opens offline from the second visit on: the first visit loaded
 * the page, the data, the prices and the basemap style before this worker
 * existed (the page registers it once the map has drawn). Best effort; when
 * offline, the page fills the caches as it loads.
 */
async function seed(): Promise<void> {
  const pages = [
    SHELL_URL,
    ...DATA_FILES.map((file) => new URL(file, SCOPE).href),
  ]
  await Promise.all([
    ...pages.map((url) =>
      fetchAndStore(PAGES_CACHE, url, { cache: 'no-cache' }),
    ),
    PRICES_URL ? fetchAndStore(PRICES_CACHE, PRICES_URL) : null,
    seedBasemap(),
  ])
}

/** The style and the TileJSON it points to; tiles come as they are seen. */
async function seedBasemap(): Promise<void> {
  const style = await fetchAndStore(BASEMAP_CACHE, MANIFEST.basemapStyle)
  if (!style) return
  const parsed: unknown = await style.json().catch(() => null)
  const sources =
    typeof parsed === 'object' && parsed !== null && 'sources' in parsed
      ? Object.values(Object(parsed.sources))
      : []
  const urls = sources.flatMap((source) =>
    typeof source === 'object' &&
    source !== null &&
    'url' in source &&
    typeof source.url === 'string' &&
    new URL(source.url).hostname === BASEMAP_HOST
      ? [source.url]
      : [],
  )
  await Promise.all(urls.map((url) => fetchAndStore(BASEMAP_CACHE, url)))
}

/** Fetches and caches one URL; returns a readable copy, or null on failure. */
async function fetchAndStore(
  cacheName: string,
  url: string,
  init?: RequestInit,
): Promise<Response | null> {
  try {
    const response = await fetch(url, init)
    if (!isStorable(response)) return null
    await store(cacheName, url, response.clone())
    return response
  } catch {
    return null
  }
}

async function store(
  cacheName: string,
  key: string,
  response: Response,
): Promise<void> {
  const cache = await caches.open(cacheName)
  await cache.put(key, cacheName === BASEMAP_CACHE ? stamp(response) : response)
}

// --- Activate: take over, drop old caches ----------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await pruneCaches()
      await self.clients.claim()
    })(),
  )
})

/**
 * Keeps this build's assets and the previous build's, so a page that is
 * still open on the previous version can lazy-load its map chunk after the
 * deploy removed it from the server. Older builds and unknown caches go.
 */
async function pruneCaches(): Promise<void> {
  const keep = new Set([APP_CACHE, PAGES_CACHE, BASEMAP_CACHE, PRICES_CACHE])
  const names = await caches.keys()
  // caches.keys() lists caches in creation order: the last one is newest.
  const previous = names
    .filter((name) => name.startsWith(APP_PREFIX) && name !== APP_CACHE)
    .at(-1)
  if (previous) keep.add(previous)
  await Promise.all(
    names
      .filter((name) => name.startsWith(PREFIX) && !keep.has(name))
      .map((name) => caches.delete(name)),
  )
  await trimBasemap()
}

// --- Fetch -----------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.headers.has('range')) return
  const url = new URL(request.url)

  if (request.mode === 'navigate') {
    if (isShell(url)) respondNetworkFirst(event, PAGES_CACHE, SHELL_URL, true)
    return
  }
  if (url.origin === SCOPE.origin) {
    if (!url.href.startsWith(SCOPE.href) || url.href === SCOPE.href) return
    if (url.href.startsWith(ASSETS_PREFIX)) {
      event.respondWith(cacheFirst(request))
      return
    }
    if (url.pathname.endsWith('/sw.js')) return
    respondNetworkFirst(event, PAGES_CACHE, url.href, false)
    return
  }
  if (url.hostname === BASEMAP_HOST) {
    if (isBasemapIndex(url))
      respondNetworkFirst(event, BASEMAP_CACHE, url.href, false)
    else respondStaleWhileRevalidate(event)
    return
  }
  if (PRICES_URL && url.href.split('?')[0] === PRICES_URL)
    respondNetworkFirst(event, PRICES_CACHE, url.href, false)
})

/** The app page itself: the scope URL or its index.html, any query. */
function isShell(url: URL): boolean {
  const path = `${url.origin}${url.pathname}`
  return path === SHELL_URL || path === `${SHELL_URL}index.html`
}

/** The style and TileJSON say which tile version to load: never stale. */
function isBasemapIndex(url: URL): boolean {
  return url.pathname.startsWith('/styles/') || !/\.\w+$/.test(url.pathname)
}

/** Same-origin or CORS, complete, successful, not redirected. Never opaque. */
function isStorable(response: Response): boolean {
  return (
    response.status === 200 &&
    !response.redirected &&
    (response.type === 'basic' ||
      response.type === 'cors' ||
      response.type === 'default')
  )
}

async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request.url, { ignoreVary: true })
  if (cached) return cached
  // Not cached (precaching still running, or a chunk the build doesn't
  // precache, serviceWorker.ts precacheList): fetch and keep it. A 404 here
  // means a deploy removed the file; LazyMapView reloads once to recover.
  const response = await fetch(request)
  if (isStorable(response)) {
    const cache = await caches.open(APP_CACHE)
    await cache.put(request.url, response.clone())
  }
  return response
}

function respondNetworkFirst(
  event: FetchEvent,
  cacheName: string,
  key: string,
  navigation: boolean,
): void {
  const { request } = event
  const sameOrigin = new URL(request.url).origin === SCOPE.origin
  // Our own files: past the HTTP cache too (GitHub Pages sends a 10 min
  // max-age), revalidated with the ETag, so a deploy shows up at once. A
  // navigation request can't be refetched as is, hence the URL.
  const network = navigation
    ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
    : fetch(sameOrigin ? new Request(request, { cache: 'no-cache' }) : request)
  // Registered first, so it clones the body before the page reads it.
  const saved = network.then((response) =>
    isStorable(response) ? store(cacheName, key, response.clone()) : undefined,
  )
  // Keep the worker alive until the fresh copy is stored, even when the page
  // was already answered from the cache.
  event.waitUntil(saved.then(noop, noop))
  event.respondWith(networkFirst(network, cacheName, key, navigation))
}

async function networkFirst(
  network: Promise<Response>,
  cacheName: string,
  key: string,
  navigation: boolean,
): Promise<Response> {
  const fallback = async (): Promise<Response | undefined> => {
    const cache = await caches.open(cacheName)
    const cached = await cache.match(key, { ignoreVary: true })
    if (!cached || !navigation) return cached
    return (await shellIsComplete(cached)) ? cached : undefined
  }
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS),
  )
  // A page must not be answered with a followed redirect: redirect it.
  const deliver = (response: Response): Response =>
    navigation && response.redirected
      ? Response.redirect(response.url, 302)
      : response
  try {
    const first = await Promise.race([network, timeout])
    if (first !== 'timeout') {
      if (first.status < 500) return deliver(first)
      return (await fallback()) ?? first
    }
    // Slow network: answer from the cache if we can, else keep waiting.
    return (await fallback()) ?? deliver(await network)
  } catch (error) {
    const cached = await fallback()
    if (cached) return cached
    throw error
  }
}

/**
 * A cached page is only worth serving if every hashed file it links is
 * cached too; otherwise it would load blank. Then the browser's own offline
 * page is the more honest answer.
 */
async function shellIsComplete(page: Response): Promise<boolean> {
  const html = await page.clone().text()
  const paths = [...html.matchAll(/(?:src|href)="\.?\/?(assets\/[^"]+)"/g)]
  for (const [, path] of paths) {
    if (!path) continue
    const url = new URL(path, SCOPE).href
    if (!(await caches.match(url, { ignoreVary: true }))) return false
  }
  return true
}

// --- Basemap: stale-while-revalidate, bounded ------------------------------

let basemapPuts = 0

function respondStaleWhileRevalidate(event: FetchEvent): void {
  const { request } = event
  // Revalidation goes through the HTTP cache: no download while OpenFreeMap's
  // own caching headers say the copy is fresh.
  const network = fetch(request)
  const saved = network.then(async (response) => {
    if (!isStorable(response)) return
    await store(BASEMAP_CACHE, request.url, response.clone())
    if (++basemapPuts % 50 === 0) await trimBasemap()
  })
  event.waitUntil(saved.then(noop, noop))
  event.respondWith(staleWhileRevalidate(request.url, network))
}

async function staleWhileRevalidate(
  key: string,
  network: Promise<Response>,
): Promise<Response> {
  const cache = await caches.open(BASEMAP_CACHE)
  const cached = await cache.match(key, { ignoreVary: true })
  if (cached && !isExpired(cached)) return cached
  // Nothing cached, or too old: the network, with the old copy as fallback.
  try {
    return await network
  } catch (error) {
    if (cached) return cached
    throw error
  }
}

function stamp(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set(STORED_AT, String(Date.now()))
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function isExpired(response: Response): boolean {
  const storedAt = Number(response.headers.get(STORED_AT))
  return !storedAt || Date.now() - storedAt > BASEMAP_MAX_AGE_MS
}

/** Drops expired entries, then the oldest ones above the entry cap. */
async function trimBasemap(): Promise<void> {
  const cache = await caches.open(BASEMAP_CACHE)
  const live: Request[] = []
  for (const request of await cache.keys()) {
    const response = await cache.match(request)
    if (!response || isExpired(response)) await cache.delete(request)
    else live.push(request)
  }
  // cache.keys() lists entries in insertion order: the first are the oldest.
  const excess = live.length - BASEMAP_MAX_ENTRIES
  for (const request of live.slice(0, Math.max(0, excess)))
    await cache.delete(request)
}

function noop(): void {}

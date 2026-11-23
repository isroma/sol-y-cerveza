// The offline service worker (sw/sw.ts) on production builds served under
// /sol-y-cerveza/ like GitHub Pages (scripts/sw-test-server.mjs), in the
// playwright.config.ts "offline" project. Basemap stubbed, no other network.

import {
  expect,
  test as base,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import {
  basemapStyle,
  SUNNY_INSTANT,
  TERRACE_COUNT,
  terracesFile,
} from './fixtures.ts'

/** scripts/sw-test-server.mjs, started by playwright.config.ts. */
const ORIGIN = 'http://localhost:5299'
const SITE = `${ORIGIN}/sol-y-cerveza/`

type Site = 'a' | 'b' | 'kill'

async function deploy(request: APIRequestContext, site: Site) {
  const response = await request.post(`${ORIGIN}/__test/deploy?site=${site}`)
  expect(response.status()).toBe(204)
}

async function serveData(request: APIRequestContext, data: unknown) {
  const response = await request.post(`${ORIGIN}/__test/data`, {
    data: data === null ? '' : JSON.stringify(data),
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(204)
}

const test = base.extend<{ errors: string[] }>({
  // Every test: the stub basemap (also for the worker's own requests), a
  // pinned sunny instant, build "a" with the fixture data, and no uncaught
  // exceptions or console errors unless the test expects some.
  errors: [
    async ({ page, context, request }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/styles/liberty'))
          return route.fulfill({
            json: basemapStyle,
            headers: { 'access-control-allow-origin': '*' },
          })
        if (url.hostname === 'basemap.test')
          return route.fulfill({
            contentType: 'application/x-protobuf',
            headers: { 'access-control-allow-origin': '*' },
            body: '',
          })
        if (url.hostname === 'localhost') return route.continue()
        errors.push(`unexpected request: ${url.href}`)
        return route.abort('blockedbyclient')
      })
      await page.clock.setFixedTime(SUNNY_INSTANT)
      await deploy(request, 'a')
      await serveData(request, terracesFile)
      await use(errors)
    },
    { auto: true },
  ],
})

// One server, switched between deploys: run these one at a time.
test.describe.configure({ mode: 'default' })

async function openApp(page: Page) {
  await page.goto(SITE)
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
}

/** Waits until the worker controls the page (it claims it on activation). */
async function waitForWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null)
}

const cacheNames = (page: Page) => page.evaluate(() => caches.keys())

const registrations = (page: Page) =>
  page.evaluate(async () => {
    const all = await navigator.serviceWorker.getRegistrations()
    return all.map((r) => r.scope)
  })

/** The map chunk the page's index.html preloads (one per build). */
const mapChunk = (page: Page) =>
  page.locator('link[rel="modulepreload"]').getAttribute('href')

/** The fixture data with the first venue renamed. */
function renamedData(name: string) {
  const data = structuredClone(terracesFile)
  const first = data.terraces[0]
  if (!first) throw new Error('fixture has no venues')
  first.name = name
  return data
}

test('installs on the first visit and opens offline on the second', async ({
  page,
  context,
  request,
  errors,
}) => {
  await openApp(page)
  await waitForWorker(page)
  expect(await registrations(page)).toEqual([SITE])
  const names = await cacheNames(page)
  expect(names).toEqual(
    expect.arrayContaining(['syc-pages-v1', 'syc-basemap-v1']),
  )
  expect(names.filter((n) => n.startsWith('syc-app-'))).toHaveLength(1)

  await context.setOffline(true)
  // Proof that the reload below comes from the cache: the server now has
  // other data, which an online load would show.
  await serveData(request, renamedData('Bar Solo En Línea'))
  await page.reload()
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await expect(
    page.getByRole('button', { name: /Bar Sol Uno/ }).first(),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /Bar Solo En Línea/ }),
  ).toHaveCount(0)
  await expect(
    page.getByRole('heading', { name: 'Sol y Cerveza' }),
  ).toBeVisible()
  await expect(page.locator('.venue-row').first()).toBeVisible()
  await expect(page.locator('.pin--sun').first()).toBeVisible()
  expect(errors).toEqual([])

  // And the network really is off, for the worker too (this logs the one
  // expected "Failed to load resource").
  expect(
    await page.evaluate(() =>
      fetch('./data/licenses/not-cached.txt').then(
        () => 'online',
        () => 'offline',
      ),
    ),
  ).toBe('offline')
})

test('a new deploy reaches the next load; an open old page keeps working', async ({
  page,
  context,
  request,
  errors,
}) => {
  await openApp(page)
  await waitForWorker(page)
  const oldChunk = await mapChunk(page)
  expect(oldChunk).toMatch(/^\.\/assets\/MapView-.+\.js$/)
  await page.evaluate(() => {
    Object.assign(window, { __stillOpen: true, __controllerChanged: false })
    navigator.serviceWorker.addEventListener('controllerchange', () =>
      Object.assign(window, { __controllerChanged: true }),
    )
  })

  await deploy(request, 'b')
  // The deploy removed the old chunk from the server.
  expect((await request.get(new URL(oldChunk ?? '', SITE).href)).status()).toBe(
    404,
  )

  // A new visit gets the new page and assets, and installs the new worker.
  const fresh = await context.newPage()
  await fresh.clock.setFixedTime(SUNNY_INSTANT)
  fresh.on('pageerror', (error) => errors.push(error.message))
  await openApp(fresh)
  const newChunk = await mapChunk(fresh)
  expect(newChunk).not.toBe(oldChunk)
  await page.waitForFunction(() => window.__controllerChanged === true)

  // The old page was taken over but not reloaded, and can still load its
  // old map chunk: the previous build's cache is kept.
  expect(await page.evaluate(() => window.__stillOpen)).toBe(true)
  const status = await page.evaluate(
    async (url) => (await fetch(url)).status,
    oldChunk ?? '',
  )
  expect(status).toBe(200)
  const apps = (await cacheNames(page)).filter((n) => n.startsWith('syc-app-'))
  expect(apps).toHaveLength(2)

  // Its next load is the new version.
  await page.reload()
  expect(await mapChunk(page)).toBe(newChunk)
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT)
  expect(errors).toEqual([])
})

test('a changed terraces.json shows on the next online load', async ({
  page,
  context,
  request,
  errors,
}) => {
  await openApp(page)
  await waitForWorker(page)
  await serveData(request, renamedData('Bar Recién Publicado'))

  await page.reload()
  const pin = page.getByRole('button', { name: /^Bar Recién Publicado/ })
  await expect(pin.first()).toBeVisible({ timeout: 15_000 })

  // And the cache now holds the new data for offline use.
  await context.setOffline(true)
  await page.reload()
  await expect(pin.first()).toBeVisible({ timeout: 15_000 })
  expect(errors).toEqual([])
})

test('is not registered inside Capacitor', async ({ page, errors }) => {
  await page.addInitScript(() => {
    Object.assign(window, { Capacitor: { isNativePlatform: () => true } })
  })
  await openApp(page)
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        document.readyState === 'complete'
          ? resolve(null)
          : window.addEventListener('load', resolve),
      ),
  )
  // Registration would start right after the load event.
  await page.waitForTimeout(1500)
  expect(await registrations(page)).toEqual([])
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBe(
    null,
  )
  expect(errors).toEqual([])
})

test('the admin is not part of the built site', async ({ request }) => {
  expect((await request.get(`${SITE}admin.html`)).status()).toBe(404)
})

test('the kill switch unregisters the worker and clears the caches', async ({
  page,
  request,
  errors,
}) => {
  await openApp(page)
  await waitForWorker(page)
  expect(await cacheNames(page)).not.toEqual([])

  await deploy(request, 'kill')
  // The browser checks sw.js on any navigation in scope and installs the
  // kill switch, even where none of the app's code runs (as if it were
  // broken): here, the favicon opened as a page.
  await page.goto(`${SITE}favicon.svg`)
  await expect
    .poll(async () => (await registrations(page)).length, { timeout: 10_000 })
    .toBe(0)
  await expect.poll(() => cacheNames(page), { timeout: 10_000 }).toEqual([])

  // From now on the site runs without a worker.
  await page.goto(SITE)
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await page.waitForTimeout(1500)
  expect(await registrations(page)).toEqual([])
  expect(errors).toEqual([])
})

test('the kill switch also works on a plain reload of the app', async ({
  page,
  request,
  errors,
}) => {
  await openApp(page)
  await waitForWorker(page)
  await deploy(request, 'kill')
  // The old worker serves the new page, whose code asks for the update too.
  await page.reload()
  await expect
    .poll(async () => (await registrations(page)).length, { timeout: 10_000 })
    .toBe(0)
  await expect.poll(() => cacheNames(page), { timeout: 10_000 }).toEqual([])
  await page.reload()
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await page.waitForTimeout(1500)
  expect(await registrations(page)).toEqual([])
  expect(errors).toEqual([])
})

// A page whose map chunk is gone from the server and from every cache (e.g.
// a deploy, with no worker or an evicted cache): LazyMapView reloads once.
test.describe('map chunk missing', () => {
  // Without a worker, so the test's routes see the page's requests.
  test.use({ serviceWorkers: 'block' })

  /** Counts page loads; the map chunk 404s while `missing(loads)`. */
  async function breakMapChunk(
    page: Page,
    missing: (loads: number) => boolean,
  ) {
    const counter = { loads: 0 }
    page.on('domcontentloaded', () => counter.loads++)
    await page.route(/\/assets\/MapView-[^/]+\.js$/, (route) =>
      missing(counter.loads)
        ? route.fulfill({ status: 404, body: 'Not found' })
        : route.continue(),
    )
    return counter
  }

  const only404s = (errors: string[]) =>
    errors.filter((e) => !/status of 404|dynamically imported module/.test(e))

  test('reloads once and then shows the map', async ({ page, errors }) => {
    const counter = await breakMapChunk(page, (loads) => loads <= 1)
    await page.goto(SITE)
    await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
      timeout: 15_000,
    })
    expect(counter.loads).toBe(2)
    expect(only404s(errors)).toEqual([])
  })

  test('gives up after one reload, without a loop', async ({
    page,
    errors,
  }) => {
    const counter = await breakMapChunk(page, () => true)
    await page.goto(SITE)
    await expect(page.getByRole('alert')).toContainText(
      'No se pudo cargar el mapa',
      { timeout: 15_000 },
    )
    await page.waitForTimeout(3000)
    expect(counter.loads).toBe(2)
    // The rest of the app still works.
    await expect(page.locator('.venue-row').first()).toBeVisible()
    expect(only404s(errors)).toEqual([])
  })
})

declare global {
  interface Window {
    __stillOpen?: boolean
    __controllerChanged?: boolean
  }
}

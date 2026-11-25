# ADR-0011: Offline: a network-first service worker

- Status: accepted (2026-11-23)
- Date: 2026-11-23
- Issue: #176 (built in #188)

## Context

The web app had a manifest but no service worker, so repeat visits downloaded everything again and the app did not open without a connection (#176; the roadmap of 2026-11-23 listed offline caching). The issue asked for a worker that never serves a stale app: a new deploy picked up on the next online load, and a way to switch the worker off. GitHub Pages sends a 10 minute `max-age`, so even plain HTTP caching can serve an old page.

## Decision

A small hand-written worker (`web/sw/sw.ts`, no runtime dependencies), emitted as `dist/sw.js` by a Vite plugin (`web/plugins/serviceWorker.ts`) with the build's hashed-asset list prepended. #188 chose this over Workbox or `vite-plugin-pwa` because each strategy is a few dozen lines, and the freshness rules are easier to read and test spelled out than as framework config.

1. **Never stale: network-first for the page and data.** The page, `data/terraces.json`, icons and other unhashed files are fetched from the network past the HTTP cache (`cache: 'no-cache'`, an ETag revalidation), with a **3 s timeout** (`NETWORK_TIMEOUT_MS`). The cache answers only when offline, slow or on a 5xx, and a response that arrives late still updates it for the next load. A cached page is served only if every `assets/` file it links is cached too.
2. **Per-build asset cache.** `assets/*-<hash>.*` are precached at install and served cache-first from `syc-app-<build>`, where the build id is a hash of the asset names (`buildId`), so a data-only publish doesn't reinstall the worker. The previous build's cache is kept, so a page still open on it can load its old map chunk after a deploy removed it from the server. If a chunk is gone from both, `LazyMapView` reloads once (guarded by `sessionStorage`) and then shows "No se pudo cargar el mapa".
3. **Takeover without reloads.** A new worker takes over at once (`skipWaiting`, `clients.claim`) but never reloads an open page; its next load is the new version.
4. **Bounded basemap cache.** OpenFreeMap tiles, glyphs and sprites are stale-while-revalidate, capped at 600 entries and 30 days, and only CORS (or same-origin) 200 responses are stored, never opaque ones. The OpenFreeMap style and TileJSON are **network-first** with the same timeout instead (#188 chose this over stale-while-revalidate): the style points at a TileJSON that names a versioned tile path, so a stale copy could ask for a tile version OpenFreeMap has dropped.
5. **Prices.** `GET /v1/prices` is network-first. POSTs (suggestions, reports) and every other request pass through untouched.
6. **Kill switch.** With the repository variable `SW_KILL_SWITCH=1`, the deploy ships `web/sw/kill-switch.ts` as `sw.js`. Browsers check `sw.js` on every visit, even when the app's own code is broken; the kill worker deletes the site's caches and unregisters itself, without reloading pages. [Operations, "Offline and the service worker"](../operations.md#offline-and-the-service-worker) has the steps.
7. **Where it never runs.** The worker is registered only in a production build (`web/src/registerServiceWorker.ts`): not in dev (`npm run dev`, `npm run admin`), not on `admin.html`, not inside the Capacitor apps, and not in browsers without support.

## Consequences

- The app and data are as fresh as the network allows; offline or on a slow connection it opens with the last copy it saw.
- Every load revalidates the page, the data and the icons: one 304 each.
- The page, basemap and prices caches have stable `-v1` names, so offline keeps working across worker updates.
- There is no "Sin conexión" hint in the UI.
- The `offline` Playwright project (`web/e2e/offline.spec.ts`) tests it against production builds served under `/sol-y-cerveza/` by `web/scripts/sw-test-server.mjs`. #188 did not verify real GitHub Pages headers, OpenFreeMap's caching headers and terms, Safari or Firefox, or Capacitor on a device.

## Alternatives considered

- **Workbox or `vite-plugin-pwa`**: rejected in #188, see above.
- **Stale-while-revalidate for the basemap style and TileJSON**: rejected in #188 because of the versioned tile path (decision 4).

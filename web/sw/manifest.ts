/**
 * What the build tells the service worker (sw.ts). The Vite plugin
 * (serviceWorker.ts) writes it into dist/sw.js as `__SW_MANIFEST__`.
 */
export type SwManifest = {
  /** Short hash of the build's hashed asset names; names this build's cache. */
  build: string
  /** The build's hashed files, relative to the scope (`assets/index-abc.js`). */
  assets: readonly string[]
  /** Price suggestions API base URL (VITE_PRICES_API), or null when unset. */
  pricesApi: string | null
  /** The basemap style URL (src/config.ts); its host's files are cached too. */
  basemapStyle: string
}

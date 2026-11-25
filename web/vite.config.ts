import react from '@vitejs/plugin-react'
import type { HtmlTagDescriptor, Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { reviewServer } from './plugins/admin/reviewServer.ts'
import { maplibreCss } from './plugins/maplibreCss.ts'
import { serviceWorker } from './plugins/serviceWorker.ts'
import { BASEMAP_STYLE_URL } from './src/config.ts'

/**
 * The map is a lazy chunk (src/map/LazyMapView.tsx), so the browser would only
 * ask for it once the entry chunk has run. Hint it in index.html instead, so
 * MapLibre downloads in parallel with the app shell.
 *
 * The basemap style is preloaded too: MapView fetches it as it mounts, and
 * nothing on the map can load before it. `crossorigin` (anonymous) and
 * `as="fetch"` match MapView's plain `fetch(BASEMAP_STYLE_URL)` (mode cors,
 * credentials same-origin), so that fetch reuses the preloaded response.
 */
function preloadMapChunk(): Plugin {
  return {
    name: 'preload-map-chunk',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, { bundle }) {
        const chunk = Object.values(bundle ?? {}).find(
          (file) =>
            file.type === 'chunk' &&
            file.facadeModuleId?.endsWith('/src/map/MapView.tsx'),
        )
        if (chunk?.type !== 'chunk') return []
        const css = [...(chunk.viteMetadata?.importedCss ?? [])]
        // The map chunk and the chunks it imports (MapLibre's), except those
        // the entry already loads.
        const entry = Object.values(bundle ?? {}).find(
          (file) => file.type === 'chunk' && file.isEntry,
        )
        const loaded = new Set(
          entry?.type === 'chunk' ? [entry.fileName, ...entry.imports] : [],
        )
        const scripts = [chunk.fileName, ...chunk.imports].filter(
          (file) => !loaded.has(file),
        )
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'fetch',
              crossorigin: true,
              href: BASEMAP_STYLE_URL,
            },
            injectTo: 'head',
          },
          ...scripts.map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'modulepreload',
              crossorigin: true,
              href: `./${file}`,
            },
            injectTo: 'head' as const,
          })),
          ...css.map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'style',
              crossorigin: true,
              href: `./${file}`,
            },
            injectTo: 'head' as const,
          })),
        ]
      },
    },
  }
}

/**
 * MapLibre belongs in the lazy map chunk only. A single value import of it
 * from code the entry chunk reaches (even through a constant) pulls all of it
 * into the entry, which then holds back first paint: fail the build instead.
 */
function keepMaplibreOutOfEntry(): Plugin {
  return {
    name: 'keep-maplibre-out-of-entry',
    apply: 'build',
    generateBundle(_options, bundle) {
      // The entry and every chunk it imports statically (loaded with it).
      const eager = Object.values(bundle).filter(
        (file) => file.type === 'chunk' && file.isEntry,
      )
      for (const file of eager) {
        if (file.type !== 'chunk') continue
        const maplibre = file.moduleIds.find((id) =>
          id.includes('/node_modules/maplibre-gl/'),
        )
        if (maplibre)
          this.error(
            `${file.fileName} loads with the entry but bundles ${maplibre}: import MapLibre only from the map chunk (src/map/MapView.tsx and what it imports)`,
          )
        for (const name of file.imports) {
          const imported = bundle[name]
          if (imported && !eager.includes(imported)) eager.push(imported)
        }
      }
    },
  }
}

/**
 * The prices API (VITE_PRICES_API) is first called when a venue card opens:
 * open its connection early. Only when the build has one.
 */
function preconnectPricesApi(): Plugin {
  let api: string | undefined
  return {
    name: 'preconnect-prices-api',
    apply: 'build',
    configResolved(config) {
      api = config.env['VITE_PRICES_API'] || undefined
    },
    transformIndexHtml(): HtmlTagDescriptor[] {
      if (!api) return []
      return [
        {
          tag: 'link',
          // Its fetches are CORS without credentials, hence `crossorigin`.
          attrs: {
            rel: 'preconnect',
            crossorigin: true,
            href: new URL(api).origin,
          },
          injectTo: 'head',
        },
      ]
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths work both on GitHub Pages (/sol-y-cerveza/) and inside Capacitor.
  base: './',
  // reviewServer: dev-only API for the admin page (admin.html, `npm run admin`).
  // serviceWorker: emits dist/sw.js, the offline cache (sw/sw.ts).
  plugins: [
    react(),
    // Only the MapLibre CSS the map uses (src/map/maplibre.css).
    maplibreCss(),
    reviewServer(),
    preloadMapChunk(),
    keepMaplibreOutOfEntry(),
    preconnectPricesApi(),
    serviceWorker(),
  ],
  build: {
    rolldownOptions: {
      output: {
        // Libraries in chunks of their own, apart from the app code that
        // changes with almost every deploy: a returning visitor (and the
        // service worker's precache) then downloads only what changed.
        // MapLibre stays on the lazy map path; `vendor` holds the libraries
        // the entry needs anyway.
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/ },
            {
              name: 'vendor',
              test: /node_modules[\\/](react|react-dom|scheduler|zod|suncalc)[\\/]/,
            },
          ],
        },
      },
    },
  },
  // MapLibre's worker is an ES module.
  worker: { format: 'es' },
  test: {
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
    // Chosen by file name, so no test runs in the wrong one: components
    // (*.test.tsx) get a DOM, everything else (*.test.ts) runs in plain Node,
    // which starts much faster.
    projects: [
      {
        extends: true,
        test: { name: 'node', include: ['**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          include: ['**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
        },
      },
    ],
  },
})

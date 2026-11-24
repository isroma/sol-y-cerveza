import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { reviewServer } from './reviewServer.ts'
import { serviceWorker } from './serviceWorker.ts'

/**
 * The map is a lazy chunk (src/map/LazyMapView.tsx), so the browser would only
 * ask for it once the entry chunk has run. Hint it in index.html instead, so
 * MapLibre downloads in parallel with the app shell.
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
        return [
          {
            tag: 'link',
            attrs: {
              rel: 'modulepreload',
              crossorigin: true,
              href: `./${chunk.fileName}`,
            },
            injectTo: 'head',
          },
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

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths work both on GitHub Pages (/sol-y-cerveza/) and inside Capacitor.
  base: './',
  // reviewServer: dev-only API for the admin page (admin.html, `npm run admin`).
  // serviceWorker: emits dist/sw.js, the offline cache (sw/sw.ts).
  plugins: [react(), reviewServer(), preloadMapChunk(), serviceWorker()],
  // MapLibre's worker is an ES module.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
  },
})

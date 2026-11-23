import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { reviewServer } from './reviewServer.ts'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths work both on GitHub Pages (/sol-y-cerveza/) and inside Capacitor.
  base: './',
  // reviewServer: dev-only API for the admin page (admin.html, `npm run admin`).
  plugins: [react(), reviewServer()],
  // MapLibre's worker is an ES module.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})

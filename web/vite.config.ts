import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths work both on GitHub Pages (/sol-y-cerveza/) and inside Capacitor.
  base: './',
  plugins: [react()],
  // MapLibre's worker is an ES module.
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})

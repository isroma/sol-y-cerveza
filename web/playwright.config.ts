import { defineConfig, devices } from '@playwright/test'

// Browser smoke tests (e2e/): the real app and a real MapLibre map in
// Chromium, against the Vite dev server (which exposes window.__map).
// Basemap and terraces are stubbed, so the tests need no network.

const PORT = 5199
const CI = Boolean(process.env['CI'])

// Software WebGL, so the map renders on machines without a GPU (CI).
const launchOptions = {
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
  // A preinstalled Chromium when it differs from @playwright/test's own.
  executablePath: process.env['PW_CHROMIUM_PATH'] || undefined,
}

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  workers: CI ? 2 : undefined,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}/`,
    timezoneId: 'Europe/Madrid',
    locale: 'es-ES',
    trace: CI ? 'retain-on-failure' : 'off',
    launchOptions,
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // No price suggestions API, even with a local .env.local.
    env: { VITE_PRICES_API: '', VITE_TURNSTILE_SITE_KEY: '' },
  },
})

import { defineConfig, devices } from '@playwright/test'

// Browser smoke tests (e2e/): the real app and a real MapLibre map in
// Chromium, against the Vite dev server (which exposes window.__map).
// Basemap and terraces are stubbed, so the tests need no network.

const PORT = 5199
/** scripts/sw-test-server.mjs; e2e/offline.spec.ts uses the same port. */
const SW_TEST_PORT = 5299
const OFFLINE = /offline\.spec\.ts$/
/** e2e/reports.spec.ts needs a server built with the reports API configured. */
const REPORTS_PORT = 5198
const REPORTS = /reports\.spec\.ts$/
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
      testIgnore: [OFFLINE, REPORTS],
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'desktop',
      testIgnore: [OFFLINE, REPORTS],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
    // Venue reports (issue #201): the feature only shows with an API and a
    // Turnstile key; the spec stubs both.
    {
      name: 'reports-phone',
      testMatch: REPORTS,
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 375, height: 812 },
        baseURL: `http://localhost:${REPORTS_PORT}/`,
      },
    },
    {
      name: 'reports-desktop',
      testMatch: REPORTS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${REPORTS_PORT}/`,
      },
    },
    // The service worker only exists in production builds: these run
    // against builds served under /sol-y-cerveza/ (scripts/sw-test-server.mjs).
    {
      name: 'offline',
      testMatch: OFFLINE,
      // One server switched between deploys: one test at a time.
      workers: 1,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      // No price suggestions API, even with a local .env.local.
      env: { VITE_PRICES_API: '', VITE_TURNSTILE_SITE_KEY: '' },
    },
    {
      command: `npx vite --port ${REPORTS_PORT} --strictPort`,
      url: `http://localhost:${REPORTS_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        VITE_PRICES_API: 'http://prices.test',
        VITE_TURNSTILE_SITE_KEY: 'test-site-key',
      },
    },
    {
      // Builds the test sites first (a few seconds), then serves them.
      command: `node scripts/sw-test-server.mjs --port ${SW_TEST_PORT}`,
      url: `http://localhost:${SW_TEST_PORT}/sol-y-cerveza/`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})

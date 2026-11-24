import {
  defineConfig,
  devices,
  type PlaywrightTestConfig,
  type Project,
} from '@playwright/test'

// Browser smoke tests (e2e/): the real app and a real MapLibre map in
// Chromium, against the Vite dev server (which exposes window.__map).
// Basemap and terraces are stubbed, so the tests need no network.
//
// E2E_PROJECTS (comma-separated project names, e.g. "phone,reports-phone")
// runs only those projects and starts only the web servers they use; CI runs
// one job per group this way. Unset, everything runs, as `npm run e2e` always has.

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

/**
 * The phones: an iPhone 13 (viewport, touch, mobile user agent) drawn at 1
 * device pixel per CSS pixel instead of its 3. Software WebGL draws every
 * device pixel on the CPU, so at 3 each map frame cost about 4 times as much
 * (9 times the pixels), and on CI's runners the phone tests ran out of time
 * mid-drag (#247). Nothing in the app depends on the pixel ratio.
 */
const PHONE = {
  ...devices['iPhone 13'],
  browserName: 'chromium',
  deviceScaleFactor: 1,
} satisfies Project['use']

type WebServer = Exclude<
  NonNullable<PlaywrightTestConfig['webServer']>,
  readonly unknown[]
>

const SERVERS = {
  dev: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    // No price suggestions API, even with a local .env.local.
    env: { VITE_PRICES_API: '', VITE_TURNSTILE_SITE_KEY: '' },
  },
  reports: {
    command: `npx vite --port ${REPORTS_PORT} --strictPort`,
    url: `http://localhost:${REPORTS_PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      VITE_PRICES_API: 'http://prices.test',
      VITE_TURNSTILE_SITE_KEY: 'test-site-key',
    },
  },
  sw: {
    // Builds the test sites first (a few seconds), then serves them.
    command: `node scripts/sw-test-server.mjs --port ${SW_TEST_PORT}`,
    url: `http://localhost:${SW_TEST_PORT}/sol-y-cerveza/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
} satisfies Record<string, WebServer>

/** Each project with the web server its tests load. */
const PROJECTS: [keyof typeof SERVERS, Project][] = [
  [
    'dev',
    {
      name: 'phone',
      testIgnore: [OFFLINE, REPORTS],
      use: PHONE,
    },
  ],
  [
    'dev',
    {
      name: 'desktop',
      testIgnore: [OFFLINE, REPORTS],
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  // Venue reports (issue #201): the feature only shows with an API and a
  // Turnstile key; the spec stubs both.
  [
    'reports',
    {
      name: 'reports-phone',
      testMatch: REPORTS,
      use: {
        ...PHONE,
        viewport: { width: 375, height: 812 },
        baseURL: `http://localhost:${REPORTS_PORT}/`,
      },
    },
  ],
  [
    'reports',
    {
      name: 'reports-desktop',
      testMatch: REPORTS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        baseURL: `http://localhost:${REPORTS_PORT}/`,
      },
    },
  ],
  // The service worker only exists in production builds: these run
  // against builds served under /sol-y-cerveza/ (scripts/sw-test-server.mjs).
  [
    'sw',
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
]

const only = (process.env['E2E_PROJECTS'] ?? '')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean)
const unknown = only.filter(
  (name) => !PROJECTS.some(([, project]) => project.name === name),
)
if (unknown.length > 0)
  throw new Error(`E2E_PROJECTS: no project named ${unknown.join(', ')}`)
const selected =
  only.length > 0
    ? PROJECTS.filter(([, project]) => only.includes(project.name ?? ''))
    : PROJECTS

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
  projects: selected.map(([, project]) => project),
  webServer: [...new Set(selected.map(([server]) => server))].map(
    (server) => SERVERS[server],
  ),
})

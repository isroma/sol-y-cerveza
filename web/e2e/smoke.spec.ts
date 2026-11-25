import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  SUNNY_COUNT,
  SUNNY_INSTANT,
  TERRACE_COUNT,
  terracesFile,
  VENUE_COUNT,
} from './fixtures.ts'

/** The bits of the MapLibre map (window.__map, dev only) the tests use. */
type MapHandle = {
  getZoom(): number
  getBearing(): number
  jumpTo(options: { bearing?: number; zoom?: number }): void
  getLayer(id: string): { type: string } | undefined
  isMoving(): boolean
  getSource(
    id: string,
  ): { getData(): Promise<{ features?: unknown[] }> } | undefined
}

declare global {
  interface Window {
    __map?: MapHandle
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

const test = base.extend<{ errors: string[] }>({
  // Every test: a pinned sunny instant, stubbed basemap and data, no other
  // network, and no console errors or uncaught exceptions.
  errors: [
    async ({ page, context }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))

      await context.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.pathname.endsWith('/styles/liberty'))
          return route.fulfill({ json: basemapStyle })
        if (url.hostname === 'basemap.test')
          return route.fulfill({
            contentType: 'application/x-protobuf',
            body: '',
          })
        if (url.pathname.endsWith('/data/terraces.json'))
          return route.fulfill({ json: terracesFile })
        if (LOCAL_HOSTS.has(url.hostname)) return route.continue()
        errors.push(`unexpected request: ${url.href}`)
        return route.abort('blockedbyclient')
      })
      await page.clock.setFixedTime(SUNNY_INSTANT)

      await use(errors)
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 900

/** Loads the app and waits for the map and its terrace pins. */
async function openApp(page: Page) {
  await page.goto('./')
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await page.waitForFunction(() => window.__map !== undefined)
}

/** Waits for the camera to stop, then returns the zoom. */
async function settledZoom(page: Page): Promise<number> {
  await page.waitForFunction(() => window.__map?.isMoving() === false)
  return page.evaluate(() => window.__map?.getZoom() ?? NaN)
}

/** Shows the venue list: on phones it lives in the burger menu. */
async function showSidebar(page: Page) {
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await expect(
    page.getByRole('searchbox', { name: /Buscar bar/ }),
  ).toBeVisible()
}

/** A venue's row in the list (its pin on the map has the same name). */
const venueRow = (page: Page, name: string) =>
  page.locator('.venue-list').getByRole('button', { name })

const resultsTitle = (page: Page) => page.locator('#results-title')

test('loads the map with pins, legend and attribution slot', async ({
  page,
}) => {
  await openApp(page)
  await expect(
    page.getByRole('heading', { name: 'Sol y Cerveza' }),
  ).toBeVisible()
  await expect(
    page
      .getByRole('region', { name: 'Mapa de terrazas de Badajoz' })
      .locator('canvas'),
  ).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Leyenda' }),
  ).toBeVisible()
  // 13:00 in June: the open terraces are sunny pins.
  await expect(page.locator('.pin--sun')).toHaveCount(SUNNY_COUNT)
  // Ground shadows: a paper-thin extrusion layer under the 3D buildings.
  const layers = await page.evaluate(() => ({
    shadows: window.__map?.getLayer('building-shadows')?.type,
    buildings: window.__map?.getLayer('building-3d')?.type,
  }))
  expect(layers).toEqual({
    shadows: 'fill-extrusion',
    buildings: 'fill-extrusion',
  })
})

test('no service worker in dev', async ({ page }) => {
  await openApp(page)
  // The production build registers it right after the load event.
  await page.waitForLoadState('load')
  await page.waitForTimeout(1000)
  const registrations = await page.evaluate(
    async () => (await navigator.serviceWorker.getRegistrations()).length,
  )
  expect(registrations).toBe(0)
})

test('layout: phone footer and menu, desktop sidebar', async ({ page }) => {
  await openApp(page)
  const search = page.getByRole('searchbox', { name: /Buscar bar/ })
  const slider = page.getByRole('slider', { name: 'Hora del día' })
  const sunFilter = page.getByRole('switch', { name: 'Con sol ahora' })
  const firstRow = page.locator('.venue-row').first()

  if (isPhone(page)) {
    // The time bar is the footer, in view without scrolling.
    await expect(page.locator('.time-footer').locator(slider)).toBeInViewport()
    await expect(search).toBeHidden()
    await page.getByRole('button', { name: 'Abrir menú' }).click()
    await expect(search).toBeVisible()
    await expect(firstRow).toBeVisible()
    await page.getByRole('button', { name: 'Cerrar menú' }).click()
    await expect(search).toBeHidden()
    await expect(slider).toBeInViewport()
  } else {
    await expect(page.getByRole('button', { name: /menú/ })).toHaveCount(0)
    for (const part of [search, slider, sunFilter, firstRow])
      await expect(part).toBeInViewport()
  }
})

test('picking a venue from the list opens its card', async ({ page }) => {
  await openApp(page)
  await showSidebar(page)
  await venueRow(page, 'Café Sol Dos').click()
  const card = page.locator('.pin-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('Café Sol Dos')
  if (isPhone(page))
    await expect(
      page.getByRole('searchbox', { name: /Buscar bar/ }),
    ).toBeHidden()
  // The map flies in close enough for the full card.
  expect(await settledZoom(page)).toBeGreaterThanOrEqual(16.5)
  await expect(page.locator('.map-wrap')).not.toHaveClass(/is-card-folded/)
  // Up close at midday, the buildings cast ground shadows.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const source = window.__map?.getSource('building-shadows')
        return (await source?.getData())?.features?.length ?? 0
      }),
    )
    .toBeGreaterThan(0)
})

test('the card folds into its badge when zoomed out', async ({ page }) => {
  await openApp(page)
  await showSidebar(page)
  await venueRow(page, 'Bar Sol Uno').click()
  await expect(page.locator('.pin-card')).toContainText('Bar Sol Uno')
  expect(await settledZoom(page)).toBeGreaterThanOrEqual(16.5)

  const wrap = page.locator('.map-wrap')
  const zoomOut = page.getByRole('button', { name: 'Alejar' })
  await zoomOut.click()
  expect(await settledZoom(page)).toBeGreaterThanOrEqual(15)
  await expect(wrap).not.toHaveClass(/is-card-folded/)
  await zoomOut.click()
  expect(await settledZoom(page)).toBeLessThan(15)
  await expect(wrap).toHaveClass(/is-card-folded/)

  // Folded, the selected badge shows; tapping it zooms back in.
  const badge = page.locator('.pin-marker[aria-pressed="true"]')
  await expect(badge).toBeVisible()
  await expect(badge).toHaveAttribute('aria-label', /^Bar Sol Uno/)
  await badge.click()
  expect(await settledZoom(page)).toBeGreaterThanOrEqual(16.5)
  await expect(wrap).not.toHaveClass(/is-card-folded/)
  await expect(page.locator('.pin-card')).toBeVisible()
})

test('the compass turns the map back to north', async ({ page }) => {
  await openApp(page)
  await page.evaluate(() => window.__map?.jumpTo({ bearing: 60 }))
  const needle = page.locator('.compass-needle')
  await expect(needle).toHaveAttribute('style', /rotate: -60deg/)
  await page.getByRole('button', { name: 'Orientar al norte' }).click()
  await expect
    .poll(() => page.evaluate(() => window.__map?.getBearing()))
    .toBe(0)
  await expect(needle).toHaveAttribute('style', /rotate: 0deg/)
})

test('the basemap credits sit in the legend info panel', async ({ page }) => {
  await openApp(page)
  await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Información sobre los datos' })
    .click()
  const info = page.getByRole('dialog', { name: 'Sobre los datos' })
  await expect(info.getByRole('link', { name: 'OpenFreeMap' })).toBeVisible()
  await expect(info.getByRole('link', { name: 'OpenStreetMap' })).toBeVisible()
})

test('"Con sol ahora" keeps only the sunny terraces', async ({ page }) => {
  await openApp(page)
  await showSidebar(page)
  const title = resultsTitle(page)
  await expect(title).toContainText(
    `${TERRACE_COUNT} de ${VENUE_COUNT} bares · ${SUNNY_COUNT} con sol ahora`,
  )
  const sunFilter = page.getByRole('switch', { name: 'Con sol ahora' })
  await sunFilter.check()
  await expect(title).toContainText(`${SUNNY_COUNT} de ${VENUE_COUNT} bares`)
  await expect(page.locator('.venue-row')).toHaveCount(SUNNY_COUNT)
  await expect(page.locator('.pin-marker')).toHaveCount(SUNNY_COUNT)
  await sunFilter.uncheck()
  await expect(page.locator('.venue-row')).toHaveCount(TERRACE_COUNT)
})

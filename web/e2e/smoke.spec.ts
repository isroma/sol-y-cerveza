import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  lidarFile,
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
  jumpTo(options: {
    bearing?: number
    zoom?: number
    center?: [number, number]
  }): void
  getLayer(id: string): { type: string } | undefined
  getLayoutProperty(layer: string, name: string): unknown
  isMoving(): boolean
  isStyleLoaded(): boolean | void
  getLight(): { intensity?: number }
  getCanvas(): HTMLCanvasElement
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
        const lidar = lidarFile(url.pathname)
        if (lidar) return route.fulfill({ json: lidar })
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
async function openApp(page: Page, path = './') {
  await page.goto(path)
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
  // Ground shadows cast on the GPU, the LiDAR buildings and the tree crowns.
  const layers = await page.evaluate(() => ({
    shadows: window.__map?.getLayer('building-shadows')?.type,
    buildings: window.__map?.getLayer('lidar-buildings')?.type,
    trees: window.__map?.getLayer('tree-crowns')?.type,
  }))
  expect(layers).toEqual({
    shadows: 'custom',
    buildings: 'fill-extrusion',
    trees: 'fill-extrusion',
  })
  // Once ours load, the basemap's own 3D buildings are hidden.
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__map?.getLayoutProperty('building-3d', 'visibility'),
      ),
    )
    .toBe('none')
})

test('without the LiDAR files the basemap buildings stay', async ({
  page,
  errors,
}) => {
  // Offline with nothing cached, or a 404: buildings, no shadows.
  await page.route(/\/data\/(buildings|trees)\.json$/, (route) =>
    route.fulfill({ status: 404, body: 'Not found' }),
  )
  await openApp(page)
  await page.waitForFunction(() => window.__map?.isMoving() === false)
  await page.waitForTimeout(1000)
  expect(
    await page.evaluate(() =>
      window.__map?.getLayoutProperty('building-3d', 'visibility'),
    ),
  ).not.toBe('none')
  await expect(page.locator('.pin--sun')).toHaveCount(SUNNY_COUNT)
  // Only the browser's own note of the 404s.
  errors.splice(
    0,
    errors.length,
    ...errors.filter((e) => !/Failed to load resource.*404/.test(e)),
  )
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
  // Up close, the LiDAR buildings and crowns next to it.
  for (const source of ['lidar-buildings', 'tree-crowns'])
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.__map?.getSource(id)?.getData())?.features?.length ??
            0,
          source,
        ),
      )
      .toBe(2)
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

test('the location dot follows you once located', async ({ page, context }) => {
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 38.8806, longitude: -6.9706 })
  await openApp(page)
  await page.getByRole('button', { name: 'Mi ubicación' }).click()
  const dot = page.locator('.user-dot')
  await expect(dot).toHaveCount(1)
  expect(await settledZoom(page)).toBeCloseTo(17, 1)
  const before = await dot.boundingBox()

  // About 100 m north: the dot moves up, the camera stays put.
  await context.setGeolocation({ latitude: 38.8815, longitude: -6.9706 })
  await expect
    .poll(async () => (await dot.boundingBox())?.y ?? 0)
    .toBeLessThan((before?.y ?? 0) - 20)
  await expect(dot).toHaveCount(1)
  expect(await page.locator('.map-toast').count()).toBe(0)
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

/** Loses the map's WebGL context and gets it back, as a phone may under memory pressure. */
async function loseAndRestoreContext(page: Page) {
  await page.evaluate(async () => {
    const lose = window.__map
      ?.getCanvas()
      .getContext('webgl2')
      ?.getExtension('WEBGL_lose_context')
    if (!lose) throw new Error('no WEBGL_lose_context')
    lose.loseContext()
    await new Promise((resolve) => setTimeout(resolve, 200))
    lose.restoreContext()
  })
}

test('the map comes back whole after a lost WebGL context', async ({
  page,
}) => {
  await openApp(page)
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__map?.getLayoutProperty('building-3d', 'visibility'),
      ),
    )
    .toBe('none')
  const before = await page.evaluate(() => window.__map?.getLight())
  expect(before?.intensity).toBeGreaterThan(0)
  const shadows = 'custom'
  await expect
    .poll(() =>
      page.evaluate(() => window.__map?.getLayer('building-shadows')?.type),
    )
    .toBe(shadows)

  await loseAndRestoreContext(page)

  // The sun's light (else the buildings come back washed out), the shadows
  // (MapLibre drops custom layers) and the grey dots.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = window.__map
        // No style at all until the context is back.
        if (!map?.isStyleLoaded()) return null
        return {
          light: map.getLight(),
          shadows: map.getLayer('building-shadows')?.type,
          dots: map.getLayer('venues-unconfirmed')?.type,
          basemapBuildings: map.getLayoutProperty('building-3d', 'visibility'),
        }
      }),
    )
    .toEqual({
      light: before,
      shadows,
      dots: 'circle',
      basemapBuildings: 'none',
    })
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT)
})

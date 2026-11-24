import { expect, test as base, type Page } from '@playwright/test'
import { basemapStyle, SUNNY_INSTANT, terracesFile } from './fixtures.ts'

// Visitor reports (ADR-0008) on a dev server built with a reports API
// (https://api.test, playwright.config.ts) that these tests stub, together
// with Cloudflare's Turnstile script.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

/** A Turnstile stand-in: hands the widget's action back as the token. */
const TURNSTILE_STUB = `window.turnstile = {
  render(element, options) {
    setTimeout(() => options.callback('e2e-' + options.action), 0)
    return 'widget'
  },
  remove() {},
}`

const test = base.extend<{ reports: unknown[] }>({
  reports: [
    async ({ page, context }, use) => {
      const reports: unknown[] = []
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text())
      })
      page.on('pageerror', (error) => errors.push(error.message))
      await context.route('**/*', (route) => {
        const request = route.request()
        const url = new URL(request.url())
        if (url.pathname.endsWith('/styles/liberty'))
          return route.fulfill({ json: basemapStyle })
        if (url.hostname === 'basemap.test')
          return route.fulfill({
            contentType: 'application/x-protobuf',
            body: '',
          })
        if (url.pathname.endsWith('/data/terraces.json'))
          return route.fulfill({ json: terracesFile })
        if (url.hostname === 'challenges.cloudflare.com')
          return route.fulfill({
            contentType: 'text/javascript',
            body: TURNSTILE_STUB,
          })
        if (url.hostname === 'api.test') {
          const cors = { 'Access-Control-Allow-Origin': '*' }
          if (request.method() === 'OPTIONS')
            return route.fulfill({
              status: 204,
              headers: {
                ...cors,
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'GET, POST',
              },
            })
          if (url.pathname === '/v1/prices')
            return route.fulfill({ json: { prices: [] }, headers: cors })
          if (url.pathname === '/v1/reports') {
            reports.push(request.postDataJSON())
            return route.fulfill({
              status: 201,
              json: { ok: true },
              headers: cors,
            })
          }
        }
        if (LOCAL_HOSTS.has(url.hostname)) return route.continue()
        errors.push(`unexpected request: ${url.href}`)
        return route.abort('blockedbyclient')
      })
      await page.clock.setFixedTime(SUNNY_INSTANT)
      await use(reports)
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 900

const idOf = (name: string) =>
  terracesFile.terraces.find((t) => t.name === name)?.id ?? ''

/** Opens the app on a venue's card (a shared link) and waits for the map. */
async function openCard(page: Page, name: string) {
  await page.goto(`./?v=${encodeURIComponent(idOf(name))}`)
  await page.waitForFunction(() => window.__map !== undefined)
  const card = page.locator('.pin-card')
  await expect(card).toContainText(name, { timeout: 15_000 })
  return card
}

/** Waits for the camera to stop and reads the map centre. */
async function mapCenter(page: Page) {
  await page.waitForFunction(() => window.__map?.isMoving() === false)
  return page.evaluate(() => {
    const c = window.__map?.getCenter()
    return { lat: c?.lat ?? NaN, lon: c?.lng ?? NaN }
  })
}

// window.__map's type is declared in smoke.spec.ts.

test('answers "¿Tiene terraza?" from the card in one tap', async ({
  page,
  reports,
}) => {
  const card = await openCard(page, 'Bar Sin Terraza')
  await card.getByRole('button', { name: '¿Tiene terraza?' }).click()
  await card.getByRole('button', { name: 'Sí, tiene terraza' }).click()
  await expect(card.getByRole('status')).toContainText('Gracias')
  expect(reports).toEqual([
    {
      kind: 'terrace',
      venueId: idOf('Bar Sin Terraza'),
      terrace: true,
      token: 'e2e-report',
    },
  ])
})

test('places a terrace with the centre pin', async ({ page, reports }) => {
  const card = await openCard(page, 'Bar Sol Uno')
  await card.getByRole('button', { name: '¿Algo está mal?' }).click()
  await card
    .getByRole('button', { name: 'La terraza está en otro sitio' })
    .click()
  // The card makes way for the picker.
  await expect(card).toHaveCount(0)
  const bar = page.getByRole('form', { name: 'Elegir posición' })
  await expect(bar).toContainText(
    'Mueve el mapa hasta las mesas de Bar Sol Uno',
  )
  await expect(page.locator('.pick-pin')).toBeVisible()
  // Nudge the map a few metres, then send the point under the pin.
  await mapCenter(page)
  await page.evaluate(() => window.__map?.panBy([30, -20], { duration: 0 }))
  const at = await mapCenter(page)
  await bar.getByRole('button', { name: 'Enviar' }).click()
  await expect(bar.getByRole('status')).toContainText('Gracias')
  expect(reports).toHaveLength(1)
  const sent = reports[0] as Record<string, unknown>
  expect(sent).toMatchObject({ kind: 'pin', venueId: idOf('Bar Sol Uno') })
  expect(sent['lat']).toBeCloseTo(at.lat, 5)
  expect(sent['lon']).toBeCloseTo(at.lon, 5)
  // It closes by itself and the card comes back.
  await expect(bar).toHaveCount(0, { timeout: 5000 })
  await expect(page.locator('.pin-card')).toContainText('Bar Sol Uno')
})

test('adds a missing bar from the list', async ({ page, reports }) => {
  await page.goto('./')
  await page.waitForFunction(() => window.__map !== undefined)
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('button', { name: '¿Falta un bar? Añádelo' }).click()
  const bar = page.getByRole('form', { name: 'Añadir un bar' })
  await expect(bar).toBeVisible()
  // The phone menu closes so the map shows.
  await expect(page.locator('#sidebar')).toBeVisible({
    visible: !isPhone(page),
  })
  await bar.getByRole('textbox', { name: 'Nombre del bar' }).fill('Bar Nuevo')
  await bar.getByRole('button', { name: 'Enviar' }).click()
  await expect(bar.getByRole('status')).toContainText('Gracias')
  expect(reports).toMatchObject([
    {
      kind: 'add',
      name: 'Bar Nuevo',
      venueKind: 'bar',
      terrace: true,
      token: 'e2e-report',
    },
  ])
})

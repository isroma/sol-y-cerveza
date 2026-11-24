import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  SUNNY_INSTANT,
  TERRACE_COUNT,
  terracesFile,
} from './fixtures.ts'

// Venue reports (issue #201) on a real map: the reports API and Cloudflare's
// Turnstile are stubbed, so nothing leaves the machine.

// window.__map is typed in smoke.spec.ts.

/** Gets a token at once, like Turnstile's always-pass test key. */
const TURNSTILE_STUB = `window.turnstile = {
  render: (el, options) => { setTimeout(() => options.callback('test-token')); return 'w' },
  remove: () => {},
}`

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

const test = base.extend<{ reports: unknown[] }>({
  reports: [
    async ({ page, context }, use) => {
      const errors: string[] = []
      const reports: unknown[] = []
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
        if (url.hostname === 'prices.test' && url.pathname === '/v1/prices')
          return route.fulfill({ json: { prices: [] } })
        if (url.hostname === 'prices.test' && url.pathname === '/v1/reports') {
          reports.push(request.postDataJSON())
          return route.fulfill({ status: 201, json: { ok: true } })
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

/** Screenshots for reviewing the layout, when SHOTS_DIR is set. */
async function shot(page: Page, name: string) {
  const dir = process.env['SHOTS_DIR']
  if (!dir) return
  const project = isPhone(page) ? 'phone' : 'desktop'
  await page.screenshot({ path: `${dir}/${project}-${name}.png` })
}

async function settled(page: Page) {
  await page.waitForFunction(() => window.__map?.isMoving() === false)
}

async function openCard(page: Page, name: string) {
  await page.goto('./')
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await page.waitForFunction(() => window.__map !== undefined)
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.locator('.venue-list').getByRole('button', { name }).click()
  await expect(page.locator('.pin-card')).toContainText(name)
  await settled(page)
}

test('reports a closed venue from its card', async ({ page, reports }) => {
  await openCard(page, 'Bar Sol Uno')
  const card = page.locator('.pin-card')
  await card.getByRole('button', { name: '¿Algo está mal?' }).click()
  await expect(
    card.getByRole('button', { name: 'Está en otro sitio' }),
  ).toBeVisible()
  await shot(page, '2-choices')
  await card.getByRole('button', { name: 'Ya no existe' }).click()
  await expect(
    card.getByText('¿Seguro que ha cerrado o ya no existe?'),
  ).toBeVisible()
  await shot(page, '2b-confirm-closed')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  await shot(page, '5-thanks-closed')
  expect(reports).toEqual([
    { kind: 'closed', venueId: 'test:0', token: 'test-token' },
  ])
})

test('moves a venue with the centre pin', async ({ page, reports }) => {
  await openCard(page, 'Bar Sol Uno')
  await shot(page, '1-card-link')
  await page.getByRole('button', { name: '¿Algo está mal?' }).click()
  await page.getByRole('button', { name: 'Está en otro sitio' }).click()
  const bar = page.getByRole('region', { name: 'Mover Bar Sol Uno' })
  await expect(bar).toBeFocused()
  await expect(page.locator('.pin-card')).toHaveCount(0)
  await settled(page)
  const send = bar.getByRole('button', { name: 'Enviar' })
  await expect(send).toBeDisabled()
  if (isPhone(page)) await expect(page.locator('.time-footer')).toHaveCount(0)
  await shot(page, '3-move-picker')

  // Badges don't open cards while picking.
  await page
    .locator('.pin-marker[aria-label^="Bar Sol Uno"]')
    .click({ force: true })
  await expect(page.locator('.pin-card')).toHaveCount(0)

  // Move the map so the pin lands a few metres away, then send.
  const map = page.getByRole('region', { name: 'Mapa de terrazas de Badajoz' })
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  await page.mouse.move(box.x + 60, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 160, { steps: 8 })
  await page.mouse.up()
  await expect(send).toBeEnabled()
  await send.click()
  await expect(bar.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  await shot(page, '5-thanks-move')
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({ kind: 'move', venueId: 'test:0' })
  await bar.getByRole('button', { name: 'Cerrar' }).click()
  await expect(bar).toHaveCount(0)
})

test('adds a missing venue from the menu', async ({ page, reports }) => {
  await page.goto('./')
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('button', { name: '¿Falta un bar? Añádelo' }).click()
  const bar = page.getByRole('region', { name: 'Añadir un bar' })
  await expect(bar).toBeFocused()
  await expect(page.getByRole('searchbox', { name: /Buscar bar/ })).toBeVisible(
    { visible: !isPhone(page) },
  )
  await bar.getByRole('textbox', { name: 'Nombre' }).fill('Bar Nuevo')
  await bar.getByRole('combobox', { name: 'Tipo' }).selectOption('Pub')
  await page.keyboard.press('Tab')
  await shot(page, '4-add-sheet')
  if (isPhone(page)) {
    // A small phone with the keyboard closed: the pin stays clear of the bar.
    await page.setViewportSize({ width: 375, height: 667 })
    const pin = await page.locator('.picker-pin').boundingBox()
    const sheet = await bar.boundingBox()
    expect(pin && sheet && pin.y + pin.height < sheet.y).toBe(true)
    await shot(page, '4-add-sheet-375x667')
  }
  await bar.getByRole('button', { name: 'Enviar' }).click()
  await expect(bar.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    kind: 'add',
    name: 'Bar Nuevo',
    venueKind: 'pub',
    terrace: true,
  })
  // Escape is for an open picker; here Cerrar ends it.
  await bar.getByRole('button', { name: 'Cerrar' }).click()
  await expect(bar).toHaveCount(0)
})

test('Escape cancels the picker', async ({ page, reports }) => {
  await openCard(page, 'Bar Sol Uno')
  await page.getByRole('button', { name: '¿Algo está mal?' }).click()
  await page.getByRole('button', { name: 'Está en otro sitio' }).click()
  await expect(page.getByRole('region', { name: /^Mover/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: /^Mover/ })).toHaveCount(0)
  expect(reports).toEqual([])
})

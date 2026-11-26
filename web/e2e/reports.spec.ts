import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  lidarFile,
  SUNNY_INSTANT,
  TERRACE_COUNT,
  terracesFile,
} from './fixtures.ts'

// Venue reports (issue #201) on a real map: the reports API and Cloudflare's
// Turnstile are stubbed, so nothing leaves the machine.

// window.__map is typed in smoke.spec.ts.

/**
 * Gets a token at once, like Turnstile's always-pass test key; a widget
 * rendered with execution 'execute' waits for execute(). Counts each run.
 */
const TURNSTILE_STUB = `window.__checks = 0
window.__widgets = {}
window.turnstile = {
  render: (el, options) => {
    const id = 'w' + Object.keys(window.__widgets).length
    const run = () => { window.__checks++; setTimeout(() => options.callback('test-token')) }
    window.__widgets[id] = run
    if (options.execution !== 'execute') run()
    return id
  },
  execute: (id) => window.__widgets[id](),
  remove: () => {},
}`

/** How many bot checks have run on the page. */
const checks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __checks: number }).__checks)

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
        const lidar = lidarFile(url.pathname)
        if (lidar) return route.fulfill({ json: lidar })
        if (url.hostname === 'challenges.cloudflare.com')
          return route.fulfill({
            contentType: 'text/javascript',
            body: TURNSTILE_STUB,
          })
        if (url.hostname === 'prices.test' && url.pathname === '/v1/prices')
          return route.fulfill({ json: { prices: [] } })
        if (url.hostname === 'prices.test' && url.pathname === '/v1/sun')
          return route.fulfill({ json: { corrections: [] } })
        if (url.hostname === 'prices.test' && url.pathname === '/v1/changes') {
          reports.push({ change: request.postDataJSON() })
          return route.fulfill({ status: 201, json: { ok: true } })
        }
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

test('reports a closed venue from the back of its card', async ({
  page,
  reports,
}) => {
  await openCard(page, 'Bar Sol Uno')
  const card = page.locator('.pin-card')
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await expect(card.getByRole('group', { name: 'Mover' })).toBeVisible()
  await expect(card.locator('.change-title')).toBeFocused()
  // In sun now: nothing to say about the sun.
  await expect(
    card.getByRole('switch', { name: 'Ahora mismo da el sol' }),
  ).toHaveCount(0)
  // The check runs as soon as the back opens.
  await expect.poll(() => checks(page)).toBe(1)
  await shot(page, '2-card-back')
  // A price typed first: "Ya no existe" folds it away and goes alone.
  const price = card.getByRole('textbox', {
    name: 'Precio de la caña en euros',
  })
  await price.fill('1,50')
  const closed = card.getByRole('button', { name: 'Ya no existe' })
  await expect(closed).toHaveAttribute('aria-pressed', 'false')
  await closed.click()
  await expect(closed).toHaveAttribute('aria-pressed', 'true')
  await expect(price).toBeHidden()
  await expect(card.getByRole('switch', { name: 'Tiene terraza' })).toBeHidden()
  await expect(
    card.getByText(
      'Avisaremos de que este bar ha cerrado. No hace falta nada más.',
    ),
  ).toBeVisible()
  await shot(page, '2d-card-back-closed')
  // Off again brings the form back with the price; on again for sending.
  await closed.click()
  await expect(price).toHaveValue('1,50')
  await closed.click()
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  await shot(page, '5-thanks-closed')
  expect(reports).toEqual([
    { change: { venueId: 'test:0', token: 'test-token', closed: true } },
  ])
})

test('sends a price from the back of the card, then goes back', async ({
  page,
  reports,
}) => {
  await openCard(page, 'Bar Sol Uno')
  const card = page.locator('.pin-card')
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await card.getByRole('radio', { name: 'Tercio' }).click()
  await card
    .getByRole('textbox', { name: 'Precio del tercio en euros' })
    .fill('2,20')
  await shot(page, '2b-card-back-tercio')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
  )
  expect(reports).toEqual([
    {
      change: {
        venueId: 'test:0',
        token: 'test-token',
        price: { item: 'tercio', brand: 'cruzcampo', cents: 220 },
      },
    },
  ])
  await card.getByRole('button', { name: 'Volver' }).click()
  await expect(card).toContainText('Bar Sol Uno')
  await expect(
    card.getByRole('button', { name: 'Sugerir un cambio' }),
  ).toBeVisible()
})

test('moves a venue and sends it with a price, behind one check', async ({
  page,
  reports,
}) => {
  await openCard(page, 'Bar Sol Uno')
  await shot(page, '1-card-front')
  await page.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await page
    .getByRole('textbox', { name: 'Precio de la caña en euros' })
    .fill('1,80')
  await page.getByRole('button', { name: 'El bar' }).click()
  const bar = page.getByRole('region', { name: 'Mover Bar Sol Uno' })
  await expect(bar).toBeFocused()
  await expect(page.locator('.pin-card')).toHaveCount(0)
  await settled(page)
  const done = bar.getByRole('button', { name: 'Listo' })
  await expect(done).toBeDisabled()
  if (isPhone(page)) await expect(page.locator('.time-footer')).toHaveCount(0)
  await shot(page, '3-move-picker')

  // Badges don't open cards while picking.
  await page
    .locator('.pin-marker[aria-label^="Bar Sol Uno"]')
    .click({ force: true })
  await expect(page.locator('.pin-card')).toHaveCount(0)

  // Move the map so the pin lands a few metres away: back to the card.
  const map = page.getByRole('region', { name: 'Mapa de terrazas de Badajoz' })
  const box = await map.boundingBox()
  if (!box) throw new Error('no map')
  await page.mouse.move(box.x + 60, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 160, { steps: 8 })
  await page.mouse.up()
  await expect(done).toBeEnabled()
  await done.click()
  await expect(bar).toHaveCount(0)
  const card = page.locator('.pin-card')
  await expect(
    card.getByRole('group', { name: 'Mover' }).getByRole('button').first(),
  ).toHaveText(/^Bar · \d+ m$/)
  // The price typed before the trip to the map is still there.
  await expect(
    card.getByRole('textbox', { name: 'Precio de la caña en euros' }),
  ).toHaveValue('1,80')
  await shot(page, '4-card-back-moved')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  await shot(page, '5-thanks-move')
  expect(await checks(page)).toBe(1)
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    change: {
      venueId: 'test:0',
      price: { item: 'cana', brand: null, cents: 180 },
      move: {},
    },
  })
})

test('says the sun is here now, where the app says shade', async ({
  page,
  reports,
}) => {
  await openCard(page, 'Café Sombra Dos')
  const card = page.locator('.pin-card')
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  const sun = card.getByRole('switch', { name: 'Ahora mismo da el sol' })
  await expect(sun).toBeVisible()
  await expect(card.getByRole('button', { name: 'Enviar' })).toBeDisabled()
  await sun.check()
  // Enviar stays in view below the extra row.
  await expect(card.getByRole('button', { name: 'Enviar' })).toBeInViewport()
  await shot(page, '2c-card-back-sun')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Marcaremos el sol cuando tres personas coincidan.',
  )
  expect(reports).toEqual([
    { change: { venueId: 'test:6', token: 'test-token', sun: true } },
  ])
})

test("shows visitors' sun with a ~ on the card and the day strip", async ({
  page,
}) => {
  // Three networks saw sun at Bar Sombra Uno (85° all round) around midday:
  // the sun clears 64° there, 13:00 being inside that stretch.
  await page.route(/\/v1\/sun/, (route) =>
    route.fulfill({
      json: {
        corrections: [
          {
            venueId: 'test:5',
            leafOff: false,
            from: 90,
            to: 270,
            altitude: 640,
            confirmed: false,
            reporters: 3,
            last: '2026-06-20T11:00:00.000Z',
          },
        ],
      },
    }),
  )
  await openCard(page, 'Bar Sombra Uno')
  const card = page.locator('.pin-card')
  await expect(card.locator('.pin-card-sun')).toContainText(/~\d+ h/)
  await expect(card.locator('.pin-card-sun')).toContainText(
    'Según los visitantes',
  )
  await expect(card.locator('.sun-day-part.is-visitors')).toHaveCount(1)
  await expect(
    card.getByRole('img', { name: /según los visitantes/ }),
  ).toBeVisible()
  await shot(page, '1b-card-front-visitors-sun')
  // In sun now, so the back doesn't offer the sun row.
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await expect(card.getByRole('group', { name: 'Mover' })).toBeVisible()
  await expect(
    card.getByRole('switch', { name: 'Ahora mismo da el sol' }),
  ).toHaveCount(0)
})

test("shows the data's accepted sun as plain sun", async ({ page }) => {
  // The owner accepted sun at Bar Sombra Uno around midday (issue #463): the
  // cap is in terraces.json, the API serves nothing for it.
  const terraces = terracesFile.terraces.map((venue) =>
    venue.id === 'test:5'
      ? {
          ...venue,
          sun_corrections: [
            { leaf_off: false, from: 90, to: 270, altitude: 640 },
          ],
        }
      : venue,
  )
  await page.route(/\/data\/terraces\.json$/, (route) =>
    route.fulfill({ json: { ...terracesFile, terraces } }),
  )
  await openCard(page, 'Bar Sombra Uno')
  const card = page.locator('.pin-card')
  await expect(card.locator('.pin-card-sun')).toContainText(/\d+ h/)
  await expect(card.locator('.pin-card-sun')).not.toContainText('~')
  await expect(card.locator('.pin-card-sun')).not.toContainText(
    'Según los visitantes',
  )
  await expect(card.locator('.sun-day-part.is-visitors')).toHaveCount(0)
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await expect(card.getByRole('group', { name: 'Mover' })).toBeVisible()
  await expect(
    card.getByRole('switch', { name: 'Ahora mismo da el sol' }),
  ).toHaveCount(0)
})

/** Opens a venue's card from a shared link (works for venues with no terrace). */
async function openShared(page: Page, id: string, name: string) {
  await page.goto(`./?v=${encodeURIComponent(id)}`)
  await page.waitForFunction(() => window.__map !== undefined)
  await expect(page.locator('.pin-card')).toContainText(name, {
    timeout: 15_000,
  })
  await settled(page)
}

test('answers Sí on the front: two taps send the terrace', async ({
  page,
  reports,
}) => {
  await openShared(page, 'test:8', 'Bar Sin Terraza')
  const card = page.locator('.pin-card')
  const ask = card.getByRole('group', { name: '¿Tiene terraza?' })
  await expect(ask).toBeVisible()
  await shot(page, '6-card-front-ask')
  await ask.getByRole('button', { name: 'Sí' }).click()
  // The back opens with "Tiene terraza" on and the tables on offer.
  await expect(
    card.getByRole('switch', { name: 'Tiene terraza' }),
  ).toBeChecked()
  await expect(card.getByRole('button', { name: 'Las mesas' })).toBeVisible()
  await shot(page, '7-card-back-terrace-yes')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  expect(reports).toEqual([
    { change: { venueId: 'test:8', token: 'test-token', terrace: true } },
  ])
})

test('marks where the tables are and sends them with Sí', async ({
  page,
  reports,
}) => {
  await openShared(page, 'test:8', 'Bar Sin Terraza')
  await page
    .locator('.pin-card')
    .getByRole('group', { name: '¿Tiene terraza?' })
    .getByRole('button', { name: 'Sí' })
    .click()
  await page.getByRole('button', { name: 'Las mesas' }).click()
  const bar = page.getByRole('region', { name: 'Mesas de Bar Sin Terraza' })
  await expect(bar).toBeFocused()
  await expect(bar).toContainText('¿Dónde están las mesas?')
  await settled(page)
  const done = bar.getByRole('button', { name: 'Listo' })
  // Tables right at the bar's door: Listo works without moving the map.
  await expect(done).toBeEnabled()
  await expect(bar).toContainText('Si no están justo aquí, mueve el mapa')
  await shot(page, '8-tables-picker')
  await done.click()
  await expect(bar).toHaveCount(0)
  const card = page.locator('.pin-card')
  await expect(
    card.getByRole('switch', { name: 'Tiene terraza' }),
  ).toBeChecked()
  await expect(card.getByRole('button', { name: 'Mesas · aquí' })).toBeVisible()
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  expect(await checks(page)).toBe(1)
  expect(reports).toHaveLength(1)
  expect(reports[0]).toMatchObject({
    change: {
      venueId: 'test:8',
      token: 'test-token',
      terrace: true,
      pin: { lat: expect.any(Number), lon: expect.any(Number) },
    },
  })
})

test('says a known terrace is not there', async ({ page, reports }) => {
  await openCard(page, 'Bar Sol Uno')
  const card = page.locator('.pin-card')
  await expect(
    card.getByRole('group', { name: '¿Tiene terraza?' }),
  ).toHaveCount(0)
  await card.getByRole('button', { name: 'Sugerir un cambio' }).click()
  const terrace = card.getByRole('switch', { name: 'Tiene terraza' })
  await expect(terrace).toBeChecked()
  await expect(card.getByRole('button', { name: 'Las mesas' })).toBeVisible()
  await terrace.uncheck()
  await expect(card.getByRole('button', { name: 'Las mesas' })).toHaveCount(0)
  await expect(card.getByRole('button', { name: 'El bar' })).toBeVisible()
  await shot(page, '2e-card-back-no-terrace')
  await card.getByRole('button', { name: 'Enviar' }).click()
  await expect(card.getByRole('status')).toHaveText(
    '¡Gracias! Lo revisaremos antes de publicarlo.',
  )
  expect(reports).toEqual([
    { change: { venueId: 'test:0', token: 'test-token', terrace: false } },
  ])
})

test('adds a missing venue from the menu', async ({ page, reports }) => {
  await page.goto('./')
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('button', { name: 'Añadir un bar que falta' }).click()
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

test('Escape cancels the picker, back to the card', async ({
  page,
  reports,
}) => {
  await openCard(page, 'Bar Sol Uno')
  await page.getByRole('button', { name: 'Sugerir un cambio' }).click()
  await page.getByRole('button', { name: 'El bar' }).click()
  await expect(page.getByRole('region', { name: /^Mover/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: /^Mover/ })).toHaveCount(0)
  await expect(
    page.locator('.pin-card').getByRole('button', { name: 'El bar' }),
  ).toBeVisible()
  expect(reports).toEqual([])
})

test('shows the caña price on its badge once zoomed in', async ({ page }) => {
  // Visitors agree on a price for Bar Sol Uno: an estimate, so "~".
  await page.route(/\/v1\/prices/, (route) =>
    route.fulfill({
      json: {
        prices: [
          {
            venueId: 'test:0',
            item: 'cana',
            brand: null,
            cents: 150,
            voters: 5,
            last: '2026-06-01T10:00:00Z',
          },
        ],
      },
    }),
  )
  await page.goto('./')
  await expect(page.locator('.pin-marker')).toHaveCount(TERRACE_COUNT, {
    timeout: 15_000,
  })
  await page.waitForFunction(() => window.__map !== undefined)
  const marker = page.locator('.pin-marker[aria-label^="Bar Sol Uno"]')
  const price = marker.locator('.pin-price')
  // Zoomed out the badges shrink and show no price (it fades out, so it
  // stays in the page; .pin--priced is what shows it).
  await expect(marker.locator('.pin')).not.toHaveClass(/pin--priced/)
  await page.evaluate(() =>
    window.__map?.jumpTo({ center: [-6.9698, 38.8826], zoom: 17 }),
  )
  await settled(page)
  await expect(marker.locator('.pin')).toHaveClass(/pin--priced/)
  await expect(price).toHaveText('~1,50 €')
  await expect(marker).toHaveAttribute('aria-label', /caña ~1,50 €/)
  // Opening the card tucks the price into the badge on the card's curve
  // instead of removing it: a moment after the tap it is part folded.
  await marker.click()
  // It stays in the badge and folds on the card's curve (frame-by-frame
  // timing is too unsteady in a headless browser to sample).
  const tuck = await price.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      text: el.textContent,
      properties: style.transitionProperty,
      durations: style.transitionDuration,
    }
  })
  expect(tuck.text).toBe('~1,50 €')
  expect(tuck.properties).toBe('scale, opacity')
  expect(tuck.durations).toBe('0.36s, 0.2s')
  await expect(marker.locator('.pin')).not.toHaveClass(/pin--priced/)
  await expect
    .poll(() => price.evaluate((el) => getComputedStyle(el).scale))
    .toBe('0 1')
  await shot(page, 'badge-price')
})

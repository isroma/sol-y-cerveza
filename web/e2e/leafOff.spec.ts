import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  lidarFile,
  SUNNY_INSTANT,
  terracesFile,
} from './fixtures.ts'

// Leaf-off horizons (docs/adr/0007-seasonal-trees.md): a terrace under
// deciduous trees is walled in by crowns all year, but open once they are
// bare, from 1 December to 15 March. The card shows nothing extra.

/** Midday in Madrid (CET) in January: the sun is about 30° up. */
const JANUARY_NOON = new Date('2027-01-15T11:30:00Z')
/** Midday in Madrid on the last and the first day after the period. */
const MARCH_15_NOON = new Date('2027-03-15T11:30:00Z')
const MARCH_16_NOON = new Date('2027-03-16T11:30:00Z')

const NAME = 'Bar Bajo Plátanos'
const crowns = Array.from({ length: 360 }, () => 850)
const bare = Array.from({ length: 360 }, () => 50)

const withTrees = {
  ...terracesFile,
  terraces: [
    ...terracesFile.terraces,
    {
      id: 'test:trees',
      name: NAME,
      kind: 'bar',
      venue: { lat: 38.879, lon: -6.968 },
      terrace: { lat: 38.87904, lon: -6.96796 },
      sources: ['test'],
      verified: null,
      horizon: crowns,
      horizon_winter: bare,
    },
  ],
}

const INFO = /Del 1 de diciembre al 15 de marzo/

const test = base.extend<{ errors: string[] }>({
  // Stubbed basemap, no other network, no console errors.
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
        if (['localhost', '127.0.0.1'].includes(url.hostname))
          return route.continue()
        errors.push(`unexpected request: ${url.href}`)
        return route.abort('blockedbyclient')
      })
      await use(errors)
      expect(errors).toEqual([])
    },
    { auto: true },
  ],
})

async function open(page: Page, instant: Date, file: unknown) {
  await page.clock.setFixedTime(instant)
  await page.route('**/data/terraces.json', (route) =>
    route.fulfill({ json: file }),
  )
  await page.route(/\/data\/(buildings|trees)\.json$/, (route) =>
    route.fulfill({ json: lidarFile(new URL(route.request().url()).pathname) }),
  )
  await page.goto('./')
  await expect(page.locator('.pin-marker').first()).toBeVisible({
    timeout: 15_000,
  })
}

const isPhone = (page: Page) => (page.viewportSize()?.width ?? 0) < 900

/** Opens a venue's card from the list (in the menu on phones). */
async function openCard(page: Page, name: string) {
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.locator('.venue-list').getByRole('button', { name }).click()
  const card = page.locator('.pin-card')
  await expect(card).toContainText(name)
  return card
}

async function openInfo(page: Page) {
  await page
    .getByRole('button', { name: 'Información sobre los datos' })
    .click()
  return page.getByRole('dialog', { name: 'Sobre los datos' })
}

test('in January, sun through bare trees, with nothing new on the card', async ({
  page,
}) => {
  await open(page, JANUARY_NOON, withTrees)
  const card = await openCard(page, NAME)
  await expect(card).toHaveClass(/pin-card--sun/)
  await expect(card).not.toContainText('árboles')
  await expect(await openInfo(page)).toContainText(INFO)
})

test('the period ends on 15 March', async ({ page }) => {
  await open(page, MARCH_15_NOON, withTrees)
  await expect(await openCard(page, NAME)).toHaveClass(/pin-card--sun/)
  await open(page, MARCH_16_NOON, withTrees)
  await expect(await openCard(page, NAME)).not.toHaveClass(/pin-card--sun/)
})

test('in June, the same trees give shade', async ({ page }) => {
  await open(page, SUNNY_INSTANT, withTrees)
  const card = await openCard(page, NAME)
  await expect(card).not.toHaveClass(/pin-card--sun/)
})

test('data without leaf-off horizons behaves as before in January', async ({
  page,
}) => {
  await open(page, JANUARY_NOON, terracesFile)
  const card = await openCard(page, 'Bar Sol Uno')
  await expect(card).toHaveClass(/pin-card--sun/)
  const info = await openInfo(page)
  await expect(info).toBeVisible()
  await expect(info).not.toContainText(INFO)
})

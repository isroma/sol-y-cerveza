import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  lidarFile,
  SUNNY_INSTANT,
  terracesFile,
} from './fixtures.ts'

// Sol parcial (docs/data-contract.md, "Horizon envelope"): the pin sees an
// open 5° horizon, but obstacles across the terrace run from 0° to 85°, so at
// midday (sun about 70° up) only part of it is in sun.

const NAME = 'Bar Medio Sol'
/** Packed whole degrees: "#" is 0°, "y" is 85° (one past the backslash). */
const LOW = '#'.repeat(360)
const HIGH = 'y'.repeat(360)

const withPartial = {
  ...terracesFile,
  terraces: [
    ...terracesFile.terraces,
    {
      id: 'test:partial',
      name: NAME,
      kind: 'bar',
      venue: { lat: 38.8795, lon: -6.9685 },
      terrace: { lat: 38.87954, lon: -6.96846 },
      sources: ['test'],
      verified: null,
      horizon: Array.from({ length: 360 }, () => 50),
      horizon_low: LOW,
      horizon_high: HIGH,
    },
  ],
}

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

async function open(page: Page) {
  await page.clock.setFixedTime(SUNNY_INSTANT)
  await page.route('**/data/terraces.json', (route) =>
    route.fulfill({ json: withPartial }),
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

test('a partly sunny terrace shows Sol parcial on its badge, card, list and legend', async ({
  page,
}) => {
  await open(page)
  await expect(page.locator('.pin--partial')).toHaveCount(1)
  await expect(
    page.getByRole('complementary', { name: 'Leyenda' }),
  ).toContainText('Sol parcial')
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  const row = page.locator('.venue-list').getByRole('button', { name: NAME })
  await expect(row).toContainText('Sol parcial hasta las')
  await row.click()
  const card = page.locator('.pin-card')
  await expect(card).toHaveClass(/pin-card--partial/)
  await expect(card).toContainText('Sol parcial')
  await expect(card).toContainText('Parte de la terraza al sol, hasta las')
})

test('"Con sol ahora" keeps a partly sunny terrace', async ({ page }) => {
  await open(page)
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('switch', { name: 'Con sol ahora' }).click()
  await expect(
    page.locator('.venue-list').getByRole('button', { name: NAME }),
  ).toBeVisible()
})

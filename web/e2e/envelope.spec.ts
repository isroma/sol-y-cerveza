import { expect, test as base, type Page } from '@playwright/test'
import {
  basemapStyle,
  lidarFile,
  SUNNY_INSTANT,
  terracesFile,
} from './fixtures.ts'

// Horizon envelope (docs/data-contract.md): the pin is walled in (85°), but
// the lowest obstacle across the terrace is 0°, so at midday (sun about 70°
// up) part of it is in sun, and a terrace partly in sun is shown as in sun.

const NAME = 'Bar Medio Sol'
/** Packed whole degrees: "#" is 0°, "y" is 85° (one past the backslash). */
const LOW = '#'.repeat(360)
const HIGH = 'y'.repeat(360)

const withEnvelope = {
  ...terracesFile,
  terraces: [
    ...terracesFile.terraces,
    {
      id: 'test:envelope',
      name: NAME,
      kind: 'bar',
      venue: { lat: 38.8795, lon: -6.9685 },
      terrace: { lat: 38.87954, lon: -6.96846 },
      sources: ['test'],
      verified: null,
      horizon: Array.from({ length: 360 }, () => 850),
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
    route.fulfill({ json: withEnvelope }),
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

test('a terrace partly in sun looks like sun on its badge, card and list', async ({
  page,
}) => {
  await open(page)
  const legend = page.getByRole('complementary', { name: 'Leyenda' })
  await expect(legend.getByRole('listitem')).toHaveCount(4)
  await expect(legend).not.toContainText('parcial')
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  const row = page.locator('.venue-list').getByRole('button', { name: NAME })
  await expect(row).toContainText('Sol hasta las')
  await row.click()
  const card = page.locator('.pin-card')
  await expect(card).toHaveClass(/pin-card--sun/)
  await expect(card).toContainText('de sol')
  await expect(page.locator('.pin--partial')).toHaveCount(0)
})

test('"Con sol ahora" keeps a terrace partly in sun', async ({ page }) => {
  await open(page)
  if (isPhone(page))
    await page.getByRole('button', { name: 'Abrir menú' }).click()
  await page.getByRole('switch', { name: 'Con sol ahora' }).click()
  await expect(
    page.locator('.venue-list').getByRole('button', { name: NAME }),
  ).toBeVisible()
})

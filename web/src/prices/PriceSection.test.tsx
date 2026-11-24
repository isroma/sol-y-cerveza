import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { PriceSection } from './PriceSection.tsx'

// No visitor prices and no owner session: only the curated prices count.
vi.mock('./crowd.ts', async (importActual) => ({
  ...(await importActual<typeof import('./crowd.ts')>()),
  useCrowdPrices: () => [],
}))

const venue: Terrace = {
  id: 'curated:x',
  name: 'Café La Plaza',
  kind: 'cafe',
  venue: { lat: 38.88, lon: -6.97 },
  terrace: { lat: 38.88, lon: -6.97 },
  sources: ['curated'],
  verified: null,
  horizon: null,
}

describe('PriceSection', () => {
  it('shows nothing while a bar has no price', () => {
    const { container } = render(<PriceSection venue={venue} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows known prices as one compact line', () => {
    render(
      <PriceSection
        venue={{
          ...venue,
          prices: [
            { item: 'cana', brand: null, cents: 150, seen: '2026-11-20' },
          ],
        }}
      />,
    )
    const line = screen.getByRole('list', { name: 'Precios' })
    expect(line).toHaveTextContent('Caña 1,50 €')
    expect(screen.queryByRole('button')).toBeNull()
  })
})

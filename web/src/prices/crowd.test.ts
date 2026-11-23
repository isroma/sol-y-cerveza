import { describe, expect, it } from 'vitest'
import { shownPrices, type CrowdPrice } from './crowd.ts'

const visitor = (p: Partial<CrowdPrice>): CrowdPrice => ({
  venueId: 'osm:node/1',
  item: 'cana',
  brand: null,
  cents: 150,
  voters: 5,
  last: '2026-11-23T10:00:00Z',
  ...p,
})

describe('shownPrices', () => {
  it('marks visitor prices as approximate and lets curator prices win', () => {
    const shown = shownPrices(
      'osm:node/1',
      [{ item: 'cana', brand: null, cents: 160, seen: '2026-11-23' }],
      [
        visitor({ cents: 150 }),
        visitor({ item: 'tercio', brand: 'mahou-5-estrellas', cents: 220 }),
        visitor({ venueId: 'osm:node/2', cents: 999 }),
      ],
    )
    expect(shown).toEqual([
      { item: 'cana', brand: null, cents: 160, approximate: false },
      {
        item: 'tercio',
        brand: 'mahou-5-estrellas',
        cents: 220,
        approximate: true,
      },
    ])
  })

  it('orders tercios by brand popularity', () => {
    const shown = shownPrices(
      'osm:node/1',
      [],
      [
        visitor({ item: 'tercio', brand: 'sagres', cents: 200 }),
        visitor({ item: 'tercio', brand: 'cruzcampo', cents: 190 }),
      ],
    )
    expect(shown.map((p) => p.brand)).toEqual(['cruzcampo', 'sagres'])
  })
})

import { describe, expect, it } from 'vitest'
import { parseCrowdPrices, shownPrices, type CrowdPrice } from './crowd.ts'

const visitor = (p: Partial<CrowdPrice>): CrowdPrice => ({
  venueId: 'osm:node/1',
  item: 'cana',
  brand: null,
  cents: 150,
  voters: 5,
  last: '2026-11-23T10:00:00Z',
  confirmed: false,
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

  it("lets the owner's price win over the curator's", () => {
    const shown = shownPrices(
      'osm:node/1',
      [{ item: 'cana', brand: null, cents: 150, seen: '2026-11-01' }],
      [visitor({ cents: 170, confirmed: true, voters: 0 })],
    )
    expect(shown).toEqual([
      { item: 'cana', brand: null, cents: 170, approximate: false },
    ])
  })
})

describe('parseCrowdPrices', () => {
  const price = {
    venueId: 'osm:node/1',
    item: 'tercio',
    brand: 'cruzcampo',
    cents: 250,
    voters: 5,
    last: '2026-11-20T12:00:00Z',
  }

  it('reads the prices, unconfirmed unless the answer says so', () => {
    expect(
      parseCrowdPrices({ prices: [price, { ...price, confirmed: true }] }),
    ).toEqual([
      { ...price, confirmed: false },
      { ...price, confirmed: true },
    ])
  })

  it('drops a price it cannot read and keeps the rest', () => {
    const cana = { ...price, item: 'cana', brand: null, cents: 150 }
    expect(
      parseCrowdPrices({
        prices: [{ ...price, brand: 'nueva' }, cana, { ...price, cents: 2.5 }],
      }),
    ).toEqual([{ ...cana, confirmed: false }])
  })

  it.each([
    ['no prices list', {}],
    ['prices that are not a list', { prices: 'none' }],
    ['not an object', null],
  ])('rejects an answer with %s', (_label, body) => {
    expect(() => parseCrowdPrices(body)).toThrow()
  })
})

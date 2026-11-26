import { describe, expect, it } from 'vitest'
import type { VenuePrice } from '../../src/admin/pricesCsv.ts'
import { fetchOwnerPrices, mergeOwnerPrices } from './ownerPrices.ts'
import { withPhonePrices } from './publish.ts'

const API = { api: 'https://api.test', token: 'secret' }

function price(
  item: VenuePrice['item'],
  cents: number,
  seen: string,
  brand: VenuePrice['brand'] = null,
): VenuePrice {
  return { venueId: 'osm:node/1', item, brand, cents, seen }
}

/** A fetch that answers the owner prices with `rows` (or fails). */
function api(rows: unknown, status = 200): typeof fetch {
  return async (input, init) => {
    expect(String(input)).toBe('https://api.test/v1/admin/owner-prices')
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Bearer secret',
    )
    return new Response(JSON.stringify({ prices: rows }), { status })
  }
}

describe('owner prices', () => {
  it('reads the API rows the CSV can hold', async () => {
    const prices = await fetchOwnerPrices(
      API,
      api([
        { venue_id: 'osm:node/1', item: 'cana', brand: '', cents: 150, seen: '2026-11-26' },
        { venue_id: 'osm:node/1', item: 'tercio', brand: 'mahou-5-estrellas', cents: 220, seen: '2026-11-26' },
        { venue_id: 'osm:node/1', item: 'cana', brand: '', cents: 9999, seen: '2026-11-26' },
      ]),
    ) // prettier-ignore
    expect(prices).toEqual([
      price('cana', 150, '2026-11-26'),
      price('tercio', 220, '2026-11-26', 'mahou-5-estrellas'),
    ])
    await expect(fetchOwnerPrices(API, api([], 401))).rejects.toThrow('401')
  })

  it('keeps the newer price, the owner winning a tie', () => {
    const csv = [
      price('cana', 140, '2026-11-20'),
      price('tercio', 200, '2026-11-25', 'mahou-5-estrellas'),
    ]
    const owner = [
      price('cana', 150, '2026-11-26'), // newer: replaces
      price('tercio', 210, '2026-11-24', 'mahou-5-estrellas'), // older: kept out
      price('tercio', 230, '2026-11-26', 'estrella-galicia'), // new row
    ] // prettier-ignore
    const { prices, changed } = mergeOwnerPrices(csv, owner)
    expect(changed).toBe(2)
    expect(prices).toEqual(
      expect.arrayContaining([
        price('cana', 150, '2026-11-26'),
        price('tercio', 200, '2026-11-25', 'mahou-5-estrellas'),
        price('tercio', 230, '2026-11-26', 'estrella-galicia'),
      ]),
    )
    expect(prices).toHaveLength(3)
    // The same day, the owner's (seen at the bar) wins; the same price is no change.
    expect(
      mergeOwnerPrices(csv, [price('cana', 145, '2026-11-20')]).changed,
    ).toBe(1)
    expect(
      mergeOwnerPrices(csv, [price('cana', 140, '2026-11-20')]).changed,
    ).toBe(0)
  })

  it('ships them with Publish, or the CSV as it is without the API', async () => {
    const csv = 'venue_id,item,brand,cents,seen\nosm:node/1,cana,,140,2026-11-20\n'
    const rows = [{ venue_id: 'osm:node/1', item: 'cana', brand: null, cents: 150, seen: '2026-11-26' }]
    expect(await withPhonePrices(csv, API, api(rows))).toEqual({
      prices: 'venue_id,item,brand,cents,seen\nosm:node/1,cana,,150,2026-11-26\n',
      phonePrices: 1,
    })
    expect(await withPhonePrices(csv, null)).toEqual({ prices: csv, phonePrices: null })
    expect(await withPhonePrices(csv, API, api([], 503))).toEqual({ prices: csv, phonePrices: null })
    expect(await withPhonePrices(null, API, api(rows))).toEqual({
      prices: 'venue_id,item,brand,cents,seen\nosm:node/1,cana,,150,2026-11-26\n',
      phonePrices: 1,
    })
  }) // prettier-ignore
})

import { describe, expect, it } from 'vitest'
import {
  allowedOrigin,
  consensus,
  parseSuggestion,
  safeEqual,
  THRESHOLD,
  type PriceGroup,
} from './logic.ts'

const valid = {
  venueId: 'osm:node/1',
  item: 'tercio',
  brand: 'cruzcampo',
  cents: 200,
  token: 'turnstile-token',
}

describe('parseSuggestion', () => {
  it('accepts a plausible caña or tercio', () => {
    expect(parseSuggestion(valid)).toEqual({
      ok: true,
      value: { venueId: 'osm:node/1', item: 'tercio', brand: 'cruzcampo', cents: 200 },
      token: 'turnstile-token',
    })
    expect(parseSuggestion({ ...valid, item: 'cana', brand: null, cents: 150 }).ok).toBe(true)
  })

  it.each([
    [{ ...valid, venueId: 'google:123' }, 'venueId'],
    [{ ...valid, item: 'jarra' }, 'item'],
    [{ ...valid, brand: null }, 'brand'],
    [{ ...valid, item: 'cana', brand: 'cruzcampo', cents: 150 }, 'brand'],
    [{ ...valid, brand: 'unknown' }, 'brand'],
    [{ ...valid, cents: 2.5 }, 'cents'],
    [{ ...valid, cents: 5000 }, 'cents'],
    [{ ...valid, item: 'cana', brand: null, cents: 20 }, 'cents'],
    [{ ...valid, token: '' }, 'token'],
    ['nope', 'body'],
  ])('rejects %j (%s)', (body, error) => {
    expect(parseSuggestion(body)).toEqual({ ok: false, error })
  })
})

function group(cents: number, voters: number, last = '2026-11-23T10:00:00Z'): PriceGroup {
  return { venue_id: 'osm:node/1', item: 'cana', brand: '', cents, voters, last }
}

describe('consensus', () => {
  it(`needs ${THRESHOLD} people agreeing on the same price`, () => {
    expect(consensus([group(150, THRESHOLD - 1)])).toEqual([])
    expect(consensus([group(150, THRESHOLD)])).toEqual([
      {
        venueId: 'osm:node/1',
        item: 'cana',
        brand: null,
        cents: 150,
        voters: THRESHOLD,
        last: '2026-11-23T10:00:00Z',
        confirmed: false,
      },
    ])
  })

  it('picks the most agreed price, then the most recent', () => {
    expect(consensus([group(150, 6), group(160, 9)])[0]?.cents).toBe(160)
    expect(
      consensus([group(150, 6, '2026-11-01T00:00:00Z'), group(160, 6, '2026-11-20T00:00:00Z')])[0]
        ?.cents,
    ).toBe(160)
  })
})

describe('helpers', () => {
  it('compares tokens exactly', () => {
    expect(safeEqual('Bearer abc', 'Bearer abc')).toBe(true)
    expect(safeEqual('Bearer abc', 'Bearer abd')).toBe(false)
    expect(safeEqual('Bearer ab', 'Bearer abc')).toBe(false)
  })

  it('allows only listed origins', () => {
    const allowed = 'https://isroma.github.io,http://localhost:5173'
    expect(allowedOrigin('https://isroma.github.io', allowed)).toBe('https://isroma.github.io')
    expect(allowedOrigin('https://evil.example', allowed)).toBeNull()
    expect(allowedOrigin(null, allowed)).toBeNull()
  })
})

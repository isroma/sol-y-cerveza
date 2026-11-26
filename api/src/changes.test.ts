import { describe, expect, it } from 'vitest'
import { parseChange } from './changes.ts'

const base = { venueId: 'osm:node/1', token: 't' }
const price = { item: 'tercio', brand: 'cruzcampo', cents: 220 }
const move = { lat: 38.878, lon: -6.97 }
const pin = { lat: 38.8781, lon: -6.9701 }

describe('parseChange', () => {
  it('takes a price, a move and closed together', () => {
    expect(parseChange({ ...base, price, move, closed: true })).toEqual({
      ok: true,
      value: {
        venueId: 'osm:node/1',
        price: {
          venueId: 'osm:node/1',
          item: 'tercio',
          brand: 'cruzcampo',
          cents: 220,
        },
        reports: [
          { kind: 'move', venueId: 'osm:node/1', ...move },
          { kind: 'closed', venueId: 'osm:node/1' },
        ],
        sun: false,
      },
      token: 't',
    })
  })

  it('takes a terrace answer and a tables pin, as terrace reports', () => {
    expect(parseChange({ ...base, terrace: true, pin })).toEqual({
      ok: true,
      value: {
        venueId: 'osm:node/1',
        price: null,
        reports: [
          { kind: 'terrace', venueId: 'osm:node/1', terrace: true },
          { kind: 'pin', venueId: 'osm:node/1', ...pin },
        ],
        sun: false,
      },
      token: 't',
    })
    expect(parseChange({ ...base, terrace: false })).toEqual({
      ok: true,
      value: {
        venueId: 'osm:node/1',
        price: null,
        reports: [{ kind: 'terrace', venueId: 'osm:node/1', terrace: false }],
        sun: false,
      },
      token: 't',
    })
    expect(parseChange({ ...base, pin }).ok).toBe(true)
    expect(parseChange({ venueId: 'osm:node/1', pin }, true)).toEqual({
      ok: true,
      value: {
        venueId: 'osm:node/1',
        price: null,
        reports: [{ kind: 'pin', venueId: 'osm:node/1', ...pin }],
        sun: false,
      },
      token: 'owner',
    })
  })

  it('takes any one part alone', () => {
    expect(parseChange({ ...base, price }).ok).toBe(true)
    expect(parseChange({ ...base, move }).ok).toBe(true)
    expect(parseChange({ ...base, closed: true }).ok).toBe(true)
    expect(parseChange({ ...base, sun: true })).toEqual({
      ok: true,
      value: { venueId: 'osm:node/1', price: null, reports: [], sun: true },
      token: 't',
    })
  })

  it.each([
    ['body', null],
    ['empty', base],
    ['empty', { ...base, closed: undefined }],
    ['closed', { ...base, closed: false }],
    ['sun', { ...base, sun: false }],
    ['sun', { ...base, sun: 'yes', closed: true }],
    ['venueId', { ...base, venueId: 'google:1', sun: true }],
    ['token', { ...base, token: undefined, sun: true }],
    ['token', { ...base, closed: true, token: '' }],
    ['venueId', { venueId: 1, token: 't', closed: true }],
    ['venueId', { ...base, venueId: 'google:1', closed: true }],
    ['price', { ...base, price: 'cheap' }],
    ['price cents', { ...base, price: { ...price, cents: 9000 } }],
    [
      'price brand',
      { ...base, price: { item: 'cana', brand: 'x', cents: 150 } },
    ],
    ['move', { ...base, move: null }],
    ['move lat', { ...base, move: { lat: 40, lon: -6.97 } }],
    ['terrace', { ...base, terrace: 'yes' }],
    ['terrace', { ...base, terrace: null, closed: true }],
    ['pin', { ...base, pin: null }],
    ['pin', { ...base, pin: 'here', terrace: true }],
    ['pin lat', { ...base, pin: { lat: 40, lon: -6.97 } }],
    ['pin lon', { ...base, pin: { lat: 38.878 } }],
    ['pin with no terrace', { ...base, terrace: false, pin }],
    ['venueId', { ...base, venueId: 'google:1', terrace: true }],
  ])('refuses a bad %s', (error, body) => {
    expect(parseChange(body)).toEqual({ ok: false, error })
  })

  it("ignores a part's own venueId, kind or token", () => {
    const parsed = parseChange({
      ...base,
      price: { ...price, venueId: 'osm:node/9', token: 'x' },
      move: { ...move, kind: 'add', venueId: 'osm:node/9' },
      pin: { ...pin, kind: 'closed', venueId: 'osm:node/9', token: 'x' },
    })
    expect(parsed.ok && parsed.value.price?.venueId).toBe('osm:node/1')
    expect(parsed.ok && parsed.value.reports[0]).toEqual({
      kind: 'move',
      venueId: 'osm:node/1',
      ...move,
    })
    expect(parsed.ok && parsed.value.reports[1]).toEqual({
      kind: 'pin',
      venueId: 'osm:node/1',
      ...pin,
    })
  })
})

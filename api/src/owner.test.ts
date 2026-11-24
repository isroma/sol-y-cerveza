import { describe, expect, it } from 'vitest'
import {
  madridDate,
  parseOwnerPrice,
  withOwnerPrices,
  type CrowdPrice,
} from './logic.ts'
import { parsePhoto, parseReading, PhotoError } from './photo.ts'

describe('owner prices', () => {
  it('validates like a suggestion, without a Turnstile token', () => {
    expect(
      parseOwnerPrice({
        venueId: 'osm:node/1',
        item: 'cana',
        brand: null,
        cents: 150,
      }),
    ).toEqual({
      ok: true,
      value: { venueId: 'osm:node/1', item: 'cana', brand: null, cents: 150 },
    })
    expect(
      parseOwnerPrice({
        venueId: 'osm:node/1',
        item: 'tercio',
        brand: null,
        cents: 200,
      }),
    ).toEqual({
      ok: false,
      error: 'brand',
    })
  })

  it('replace visitor prices for the same item and are marked confirmed', () => {
    const crowd: CrowdPrice[] = [
      {
        venueId: 'osm:node/1',
        item: 'cana',
        brand: null,
        cents: 150,
        voters: 5,
        last: '2026-11-01',
        confirmed: false,
      },
      {
        venueId: 'osm:node/2',
        item: 'cana',
        brand: null,
        cents: 140,
        voters: 6,
        last: '2026-11-01',
        confirmed: false,
      },
    ]
    const shown = withOwnerPrices(crowd, [
      {
        venue_id: 'osm:node/1',
        item: 'cana',
        brand: '',
        cents: 160,
        seen: '2026-11-23',
      },
      {
        venue_id: 'osm:node/1',
        item: 'tercio',
        brand: 'cruzcampo',
        cents: 210,
        seen: '2026-11-23',
      },
    ])
    expect(
      shown.map((p) => [p.venueId, p.item, p.brand, p.cents, p.confirmed]),
    ).toEqual([
      ['osm:node/1', 'cana', null, 160, true],
      ['osm:node/1', 'tercio', 'cruzcampo', 210, true],
      ['osm:node/2', 'cana', null, 140, false],
    ])
  })

  it('dates prices in Spanish time', () => {
    expect(madridDate(new Date('2026-11-23T23:30:00Z'))).toBe('2026-11-24')
  })
})

describe('owner photos', () => {
  const jpeg = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)) // a JPEG header

  it('accepts a real image and rejects the rest', () => {
    expect(parsePhoto({ image: jpeg, mediaType: 'image/jpeg' }).mediaType).toBe(
      'image/jpeg',
    )
    expect(() => parsePhoto({ image: jpeg, mediaType: 'image/png' })).toThrow(
      PhotoError,
    )
    expect(() =>
      parsePhoto({ image: 'not base64!', mediaType: 'image/jpeg' }),
    ).toThrow(PhotoError)
    expect(() => parsePhoto('nope')).toThrow(PhotoError)
  })

  it('reads prices with the admin rules, plus the bar name', () => {
    const reading = parseReading(
      JSON.stringify({
        prices: [
          {
            item: 'cana',
            brand: null,
            cents: 150,
            label: 'Caña 1,50',
            confidence: 'high',
          },
          {
            item: 'tercio',
            brand: null,
            cents: 200,
            label: 'Tercio 2,00',
            confidence: 'high',
          },
        ],
        notes: [],
        bar_name: ' Bar Los Pozos ',
      }),
    )
    expect(reading?.barName).toBe('Bar Los Pozos')
    expect(reading?.proposals).toEqual([
      {
        item: 'cana',
        brand: null,
        cents: 150,
        label: 'Caña 1,50',
        confidence: 'high',
      },
    ])
    expect(reading?.notes.some((n) => n.includes('Tercio 2,00'))).toBe(true)
    expect(parseReading('{"prices": "nope"}')).toBeNull()
  })
})

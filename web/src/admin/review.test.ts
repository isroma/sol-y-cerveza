import { describe, expect, it } from 'vitest'
import {
  addedId,
  cleanName,
  formatReviewCsv,
  nextReview,
  parseReviewCsv,
  removeReview,
  upsertReview,
  type Review,
} from './review.ts'

const HEADER =
  'venue_id,status,name,kind,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed,looks_right\n'
const LEGACY_HEADER =
  'venue_id,status,name,kind,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed\n'
const TODAY = '2026-11-23'

const terrace: Review = {
  venueId: 'osm:node/2',
  status: 'terrace',
  name: null,
  kind: null,
  venue: null,
  terrace: { lat: 38.8812341, lon: -6.9712349 },
  reviewed: TODAY,
  looksRight: false,
}
const moved: Review = {
  venueId: 'overture:abc-1',
  status: null,
  name: null,
  kind: null,
  venue: { lat: 38.88, lon: -6.97 },
  terrace: null,
  reviewed: TODAY,
  looksRight: false,
}

describe('venue review CSV', () => {
  it('writes sorted rows with 6-decimal positions and reads them back', () => {
    const text = formatReviewCsv([moved, terrace])
    expect(text).toBe(
      HEADER +
        'osm:node/2,terrace,,,,,38.881234,-6.971235,2026-11-23,\n' +
        'overture:abc-1,,,,38.88,-6.97,,,2026-11-23,\n',
    )
    expect(parseReviewCsv(text)).toEqual([
      { ...terrace, terrace: { lat: 38.881234, lon: -6.971235 } },
      moved,
    ])
  })

  it('rejects a bad header and inconsistent rows', () => {
    expect(() => parseReviewCsv('id\n')).toThrow('header')
    expect(() =>
      parseReviewCsv(
        HEADER + 'osm:node/1,no_terrace,,,,,38.8,-6.9,2026-11-23\n',
      ),
    ).toThrow(':2:')
    expect(() =>
      parseReviewCsv(HEADER + 'google:1,terrace,,,,,,,2026-11-23\n'),
    ).toThrow()
  })

  it('keeps one row per venue', () => {
    const rows = upsertReview([terrace, moved], {
      ...terrace,
      status: null,
      terrace: null,
      venue: { lat: 1, lon: 1 },
    })
    expect(rows.filter((r) => r.venueId === 'osm:node/2')).toHaveLength(1)
    expect(removeReview(rows, 'osm:node/2').map((r) => r.venueId)).toEqual([
      'overture:abc-1',
    ])
  })
})

describe('nextReview', () => {
  it('pinning a terrace marks the venue as a terrace', () => {
    const at = { lat: 38.9, lon: -6.9 }
    expect(
      nextReview(undefined, 'osm:node/9', { kind: 'terrace', at }, TODAY),
    ).toEqual({
      venueId: 'osm:node/9',
      status: 'terrace',
      name: null,
      kind: null,
      venue: null,
      terrace: at,
      reviewed: TODAY,
      looksRight: false,
    })
  })

  it('no terrace clears the pin but keeps a moved venue', () => {
    const row = nextReview(
      { ...terrace, venue: { lat: 1, lon: 2 } },
      terrace.venueId,
      { kind: 'status', status: 'no_terrace' },
      TODAY,
    )
    expect(row.terrace).toBeNull()
    expect(row.venue).toEqual({ lat: 1, lon: 2 })
  })

  it('moving the venue keeps the decision', () => {
    const at = { lat: 38.9, lon: -6.9 }
    const row = nextReview(
      terrace,
      terrace.venueId,
      { kind: 'venue', at },
      TODAY,
    )
    expect(row.status).toBe('terrace')
    expect(row.venue).toEqual(at)
  })
})

describe('added venues', () => {
  it('round-trip with their name and kind', () => {
    const added: Review = {
      venueId: 'review:bar-nuevo',
      status: null,
      name: 'Bar Nuevo',
      kind: 'bar',
      venue: { lat: 38.879, lon: -6.971 },
      terrace: null,
      reviewed: TODAY,
      looksRight: false,
    }
    const text = formatReviewCsv([added])
    expect(text).toContain('review:bar-nuevo,,Bar Nuevo,bar,38.879,-6.971,,,')
    expect(parseReviewCsv(text)).toEqual([added])
  })

  it('need a name, kind and position, and existing venues take none', () => {
    expect(() =>
      parseReviewCsv(HEADER + 'review:x,terrace,X,,38.8,-6.9,,,2026-11-23\n'),
    ).toThrow()
    expect(() =>
      parseReviewCsv(HEADER + 'osm:node/1,terrace,X,bar,,,,,2026-11-23\n'),
    ).toThrow()
  })

  it('get a unique slug id and a CSV-safe name', () => {
    expect(addedId('Café Añil', new Set())).toBe('review:cafe-anil')
    expect(addedId('Café Añil', new Set(['review:cafe-anil']))).toBe(
      'review:cafe-anil-2',
    )
    expect(cleanName(' Bar, "El"  Sitio ')).toBe('Bar El Sitio')
  })
})

describe('looks right (Y)', () => {
  it('round-trips and reads files written before the column', () => {
    const row = HEADER + 'osm:node/1,terrace,,,,,,,2026-11-23,yes\n'
    expect(parseReviewCsv(row)[0]?.looksRight).toBe(true)
    expect(formatReviewCsv(parseReviewCsv(row))).toBe(row)
    const legacy = LEGACY_HEADER + 'osm:node/1,terrace,,,,,,,2026-11-23\n'
    expect(parseReviewCsv(legacy)[0]?.looksRight).toBe(false)
  })

  it('is only for a terrace, and moving the pin clears it', () => {
    expect(() =>
      parseReviewCsv(HEADER + 'osm:node/1,no_terrace,,,,,,,2026-11-23,yes\n'),
    ).toThrow()
    const right = nextReview(
      undefined,
      'osm:node/1',
      { kind: 'looksRight' },
      TODAY,
    )
    expect([right.status, right.looksRight]).toEqual(['terrace', true])
    const moved = nextReview(
      right,
      'osm:node/1',
      { kind: 'terrace', at: { lat: 38.9, lon: -6.9 } },
      TODAY,
    )
    expect(moved.looksRight).toBe(false)
  })
})

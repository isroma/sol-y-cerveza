import { describe, expect, it } from 'vitest'
import {
  formatReviewCsv,
  nextReview,
  parseReviewCsv,
  removeReview,
  upsertReview,
  type Review,
} from './review.ts'

const HEADER =
  'venue_id,status,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed\n'
const TODAY = '2026-11-23'

const terrace: Review = {
  venueId: 'osm:node/2',
  status: 'terrace',
  venue: null,
  terrace: { lat: 38.8812341, lon: -6.9712349 },
  reviewed: TODAY,
}
const moved: Review = {
  venueId: 'overture:abc-1',
  status: null,
  venue: { lat: 38.88, lon: -6.97 },
  terrace: null,
  reviewed: TODAY,
}

describe('venue review CSV', () => {
  it('writes sorted rows with 6-decimal positions and reads them back', () => {
    const text = formatReviewCsv([moved, terrace])
    expect(text).toBe(
      HEADER +
        'osm:node/2,terrace,,,38.881234,-6.971235,2026-11-23\n' +
        'overture:abc-1,,38.88,-6.97,,,2026-11-23\n',
    )
    expect(parseReviewCsv(text)).toEqual([
      { ...terrace, terrace: { lat: 38.881234, lon: -6.971235 } },
      moved,
    ])
  })

  it('rejects a bad header and inconsistent rows', () => {
    expect(() => parseReviewCsv('id\n')).toThrow('header')
    expect(() =>
      parseReviewCsv(HEADER + 'osm:node/1,no_terrace,,,38.8,-6.9,2026-11-23\n'),
    ).toThrow(':2:')
    expect(() =>
      parseReviewCsv(HEADER + 'google:1,terrace,,,,,2026-11-23\n'),
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
      venue: null,
      terrace: at,
      reviewed: TODAY,
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

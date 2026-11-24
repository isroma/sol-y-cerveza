import { describe, expect, it } from 'vitest'
import fixture from './fixtures/venue_proposals.csv?raw'
import {
  acceptChange,
  formatIgnored,
  openProposals,
  parseIgnored,
  parseProposalsCsv,
  proposalKey,
} from './proposals.ts'
import type { Review } from './review.ts'

function review(venueId: string, patch: Partial<Review>): Review {
  return {
    venueId,
    status: null,
    name: null,
    kind: null,
    venue: null,
    terrace: null,
    reviewed: '2026-11-24',
    looksRight: false,
    ...patch,
  }
}

describe('parseProposalsCsv', () => {
  it('keeps valid rows and reports the bad ones', () => {
    const { proposals, errors } = parseProposalsCsv(fixture)
    expect(proposals.map((p) => [p.venueId, p.kind])).toEqual([
      ['osm:node/1', 'terrace'],
      ['osm:node/1', 'position'],
      ['overture:abc-123', 'not_venue'],
      ['junta:0123456789ab', 'no_terrace'],
    ])
    expect(proposals[0]?.at).toEqual({ lat: 38.87901, lon: -6.97052 })
    expect(proposals[2]?.evidence).toBe(
      'Website says "cerrado definitivamente".',
    )
    expect(errors).toHaveLength(3)
    expect(errors[0]).toMatch(/^venue_proposals\.csv:6: /)
  })

  it('takes a header-only or empty file', () => {
    expect(
      parseProposalsCsv(
        'venue_id,kind,lat,lon,confidence,evidence,source,generated\n',
      ),
    ).toEqual({ proposals: [], errors: [] })
    expect(parseProposalsCsv('')).toEqual({ proposals: [], errors: [] })
  })

  it('rejects a wrong header as one error', () => {
    const { proposals, errors } = parseProposalsCsv('venue,kind\nx,terrace\n')
    expect(proposals).toEqual([])
    expect(errors[0]).toMatch(/header must be/)
  })
})

describe('openProposals', () => {
  const { proposals } = parseProposalsCsv(fixture)

  it('groups by venue, best confidence first', () => {
    const open = openProposals(proposals, new Map(), new Set())
    expect(open.get('osm:node/1')?.map((p) => p.kind)).toEqual([
      'terrace',
      'position',
    ])
  })

  it('drops ignored ones and those a review settles', () => {
    const terrace = proposals[0]
    if (!terrace) throw new Error('fixture has no rows')
    const reviews = new Map([
      [
        'junta:0123456789ab',
        review('junta:0123456789ab', { status: 'terrace' }),
      ],
      [
        'osm:node/1',
        review('osm:node/1', { venue: { lat: 38.8791, lon: -6.9706 } }),
      ],
    ])
    const open = openProposals(
      proposals,
      reviews,
      new Set([proposalKey(terrace)]),
    )
    expect(open.has('osm:node/1')).toBe(false)
    expect(open.has('junta:0123456789ab')).toBe(false)
    expect(open.get('overture:abc-123')).toHaveLength(1)
  })
})

describe('acceptChange', () => {
  const { proposals } = parseProposalsCsv(fixture)
  it('maps each kind to a review change', () => {
    expect(proposals.map(acceptChange)).toEqual([
      { kind: 'terrace', at: { lat: 38.87901, lon: -6.97052 } },
      { kind: 'venue', at: { lat: 38.8791, lon: -6.9706 } },
      { kind: 'status', status: 'not_venue' },
      { kind: 'status', status: 'no_terrace' },
    ])
  })
})

describe('ignored keys', () => {
  it('round-trips, sorted and without repeats', () => {
    const text = formatIgnored(['b|x', 'a|y', 'b|x'])
    expect(text).toBe('key\na|y\nb|x\n')
    expect(parseIgnored(text)).toEqual(['a|y', 'b|x'])
  })
})

import { describe, expect, it } from 'vitest'
import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Proposal } from './proposals.ts'
import type { Review } from './review.ts'
import { queueOrder, scoreVenues } from './queueScore.ts'

const CENTRE: LatLon = { lat: 38.8789, lon: -6.9707 }

/** About `m` metres east of the centre. */
function east(m: number): LatLon {
  return { lat: CENTRE.lat, lon: CENTRE.lon + m / 86_700 }
}

function venue(id: string, at: LatLon, patch: Partial<Terrace> = {}): Terrace {
  return {
    id,
    name: id,
    kind: 'bar',
    venue: at,
    terrace: null,
    sources: ['overture'],
    verified: null,
    horizon: null,
    ...patch,
  }
}

function terraceReview(venueId: string): Review {
  return {
    venueId,
    status: 'terrace',
    name: null,
    kind: null,
    venue: null,
    terrace: null,
    reviewed: '2026-11-24',
    looksRight: false,
  }
}

function proposal(venueId: string, confidence: number): Proposal {
  return {
    venueId,
    kind: 'no_terrace',
    at: null,
    confidence,
    evidence: 'No tables in any photo.',
    source: 'imagery',
    generated: '2026-11-24',
  }
}

function byId(
  venues: Terrace[],
  reviews = new Map<string, Review>(),
  proposals = new Map<string, Proposal[]>(),
) {
  return new Map(
    scoreVenues(venues, reviews, proposals, CENTRE).map((s) => [s.venue.id, s]),
  )
}

describe('scoreVenues', () => {
  it('prefers the centre', () => {
    const s = byId([venue('near', east(100)), venue('far', east(2000))])
    expect(s.get('near')?.score).toBeGreaterThan(s.get('far')?.score ?? 0)
    expect(s.get('near')?.reason).toBe('100 m from the centre')
  })

  it('prefers OSM over the Junta over Overture', () => {
    const at = east(3000)
    const s = byId([
      venue('o', at, { sources: ['osm'] }),
      venue('j', at, { sources: ['junta'] }),
      venue('v', at),
    ])
    const score = (id: string) => s.get(id)?.score ?? 0
    expect(score('o')).toBeGreaterThan(score('j'))
    expect(score('j')).toBeGreaterThan(score('v'))
    expect(s.get('o')?.reason).toBe('OSM venue')
  })

  it('prefers bars to pubs', () => {
    const s = byId([
      venue('bar', east(3000)),
      venue('pub', east(3000), { kind: 'pub' }),
    ])
    expect(s.get('bar')?.score).toBeGreaterThan(s.get('pub')?.score ?? 0)
  })

  it('counts confirmed terraces nearby, reviewed or from OSM', () => {
    const venues = [
      venue('lonely', east(1500)),
      venue('square', east(3000)),
      venue('a', east(3050)),
      venue('b', east(3060), {
        sources: ['osm'],
        terrace: east(3060),
      }),
    ]
    const s = byId(venues, new Map([['a', terraceReview('a')]]))
    expect(s.get('square')?.parts.cluster).toBeCloseTo(1.5)
    expect(s.get('square')?.reason).toBe('2 confirmed terraces within 120 m')
    expect(s.get('lonely')?.parts.cluster).toBe(0)
  })

  it('boosts a machine proposal by its confidence', () => {
    const s = byId(
      [venue('p', east(3000)), venue('q', east(3000))],
      new Map(),
      new Map([['p', [proposal('p', 0.9)]]]),
    )
    expect(s.get('p')?.parts.proposal).toBeCloseTo(1.8)
    expect(s.get('p')?.reason).toBe('Machine proposal (90 %)')
  })

  it('sinks what looks like not a venue', () => {
    const s = byId([
      venue('Telepizza Badajoz', east(100)),
      venue('Bar Pepe', east(100)),
    ])
    const junk = s.get('Telepizza Badajoz')
    expect(junk?.score).toBeLessThan(s.get('Bar Pepe')?.score ?? 0)
    expect(junk?.reason).toMatch(/^Looks like not a venue: fast food/)
  })
})

describe('queueOrder', () => {
  const venues = [
    venue('a', east(100)),
    venue('b', east(500)),
    venue('c', east(900)),
    venue('d', east(50)),
  ]
  const scored = scoreVenues(venues, new Map(), new Map(), CENTRE)

  it('leaves decided venues out and orders by score', () => {
    const reviews = new Map([['d', terraceReview('d')]])
    expect(queueOrder(scored, reviews, []).map((s) => s.venue.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('puts skipped venues last, in skip order', () => {
    expect(
      queueOrder(scored, new Map(), ['a', 'd']).map((s) => s.venue.id),
    ).toEqual(['b', 'c', 'a', 'd'])
  })
})

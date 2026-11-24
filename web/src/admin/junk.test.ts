import { describe, expect, it } from 'vitest'
import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Review } from './review.ts'
import { junkSignals, junkSignalsAll, likelyJunk } from './junk.ts'

const CENTRE: LatLon = { lat: 38.8789, lon: -6.9707 }

function east(m: number): LatLon {
  return { lat: CENTRE.lat, lon: CENTRE.lon + m / 86_700 }
}

function venue(
  id: string,
  name: string,
  at: LatLon,
  sources = ['overture'],
): Terrace {
  return {
    id,
    name,
    kind: 'bar',
    venue: at,
    terrace: null,
    sources,
    verified: null,
    horizon: null,
  }
}

const neighbour = venue('osm:node/9', 'Bar Vecino', east(20), ['osm'])

function signals(v: Terrace, others: Terrace[] = [neighbour]) {
  return junkSignals(v, [v, ...others], new Map(), CENTRE)
}

describe('junkSignals', () => {
  it('reads names that are not bars', () => {
    expect(signals(venue('overture:1', 'Mercería Yolanda', east(0)))).toEqual([
      'name',
    ])
    expect(signals(venue('overture:2', 'User4572838', east(0)))).toEqual([
      'name',
    ])
    expect(signals(venue('overture:3', "Domino's Pizza", east(0)))).toEqual([
      'takeaway',
    ])
    expect(
      signals(venue('overture:4', 'London Café Don Benito', east(0))),
    ).toEqual(['other_town'])
  })

  it('leaves a town that is the venue name alone', () => {
    expect(signals(venue('overture:5', 'Sevilla', east(0)))).toEqual([])
    expect(signals(venue('overture:6', 'Bar Nuevo Lisboa', east(0)))).toEqual(
      [],
    )
  })

  it('finds duplicates of venues from other sources', () => {
    const osm = venue('osm:node/1', 'Bar Pepe', east(100), ['osm'])
    expect(signals(venue('overture:7', 'Bar Pepe', east(0)), [osm])).toEqual([
      'duplicate',
    ])
  })

  it('lists only the second of two Overture duplicates, as weak', () => {
    const a = venue('overture:a', 'Flidais', east(0))
    const b = venue('overture:b', 'Flidais', east(150))
    expect(signals(a, [b, neighbour])).toEqual([])
    expect(signals(b, [a])).toEqual(['duplicate_overture'])
  })

  it('flags venues far out and alone', () => {
    expect(signals(venue('overture:8', 'Venta', east(5000)))).toEqual([
      'far',
      'isolated',
    ])
  })

  it('only looks at Overture-only venues', () => {
    expect(
      signals(venue('junta:aaaaaaaaaaaa', 'Estanco 30', east(0), ['junta'])),
    ).toEqual([])
  })
})

describe('likelyJunk', () => {
  it('skips reviewed venues and puts strong signals first', () => {
    const venues = [
      neighbour,
      venue('overture:far', 'Venta', east(5000)),
      venue('overture:shop', 'Estanco 30', east(10)),
      venue('overture:done', 'Telepizza', east(10)),
    ]
    const reviews = new Map<string, Review>([
      [
        'overture:done',
        {
          venueId: 'overture:done',
          status: 'no_terrace',
          name: null,
          kind: null,
          venue: null,
          terrace: null,
          reviewed: '2026-11-24',
          looksRight: false,
        },
      ],
    ])
    expect(
      likelyJunk(venues, reviews, junkSignalsAll(venues, reviews, CENTRE)).map(
        (j) => j.venue.id,
      ),
    ).toEqual(['overture:shop', 'overture:far'])
  })
})

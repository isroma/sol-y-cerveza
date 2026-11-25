import { describe, expect, it } from 'vitest'
import {
  cleanVenueName,
  distanceMetres,
  insideBadajoz,
  VENUE_ID,
} from './geo.ts'

describe('cleanVenueName', () => {
  it('turns commas, quotes and line breaks into single spaces', () => {
    expect(cleanVenueName('  Bar "El Sol",\n  Badajoz ')).toBe(
      'Bar El Sol Badajoz',
    )
    expect(cleanVenueName('La «Tasca» de ‘Pepe’')).toBe('La Tasca de Pepe')
  })
})

describe('insideBadajoz', () => {
  it('accepts the city box only, edges included', () => {
    expect(insideBadajoz({ lat: 38.878, lon: -6.97 })).toBe(true)
    expect(insideBadajoz({ lat: 38.84, lon: -7.04 })).toBe(true)
    expect(insideBadajoz({ lat: 38.95, lon: -6.97 })).toBe(false)
    expect(insideBadajoz({ lat: 38.878, lon: -7.05 })).toBe(false)
  })
})

describe('distanceMetres', () => {
  it('measures short distances in metres', () => {
    // 0.001° of latitude is about 111 m.
    const d = distanceMetres(
      { lat: 38.878, lon: -6.97 },
      { lat: 38.879, lon: -6.97 },
    )
    expect(d).toBeGreaterThan(110)
    expect(d).toBeLessThan(112)
    expect(
      distanceMetres({ lat: 38.878, lon: -6.97 }, { lat: 38.878, lon: -6.97 }),
    ).toBe(0)
  })
})

describe('VENUE_ID', () => {
  it('takes the ids each source gives', () => {
    for (const id of [
      'osm:node/123',
      'osm:way/45',
      'overture:08f39-ab',
      'junta:0123456789ab',
      'review:bar-nuevo-2',
    ])
      expect(VENUE_ID.test(id)).toBe(true)
    for (const id of ['osm:relation/1', 'junta:xyz', 'review:Bar', 'bar'])
      expect(VENUE_ID.test(id)).toBe(false)
  })
})

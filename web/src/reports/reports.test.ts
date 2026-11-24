import { describe, expect, it } from 'vitest'
import {
  cleanName,
  distanceM,
  MAX_MOVE_M,
  MAX_PIN_M,
  nameOk,
  pickProblem,
  pickReport,
  type Pick,
} from './reports.ts'

const venue = { lat: 38.878, lon: -6.97 }
const north = (m: number) => ({ lat: venue.lat + m / 111_195, lon: venue.lon })
const pin: Pick = {
  kind: 'pin',
  venueId: 'osm:node/1',
  name: 'Bar Pepe',
  from: venue,
  start: venue,
}
const added = { name: 'Bar Nuevo', venueKind: 'bar' as const, terrace: true }

describe('pickProblem', () => {
  it('keeps every pick inside Badajoz', () => {
    expect(pickProblem({ kind: 'add' }, venue)).toBeNull()
    expect(pickProblem({ kind: 'add' }, { lat: 40.4, lon: -3.7 })).toBe(
      'Ese punto está fuera de Badajoz.',
    )
  })

  it('keeps a terrace and a moved venue near the venue, as the API does', () => {
    expect(pickProblem(pin, north(MAX_PIN_M - 5))).toBeNull()
    expect(pickProblem(pin, north(MAX_PIN_M + 5))).toMatch(/150 m/)
    const move: Pick = { ...pin, kind: 'move' }
    expect(pickProblem(move, north(MAX_MOVE_M - 5))).toBeNull()
    expect(pickProblem(move, north(MAX_MOVE_M + 5))).toMatch(/500 m/)
  })

  it('measures metres', () => {
    expect(distanceM(venue, north(100))).toBeCloseTo(100, 0)
  })
})

describe('pickReport', () => {
  it('builds the API body, rounded to 6 decimals', () => {
    const at = { lat: 38.87812345678, lon: -6.97000049 }
    expect(pickReport(pin, at, added)).toEqual({
      kind: 'pin',
      venueId: 'osm:node/1',
      lat: 38.878123,
      lon: -6.97,
    })
    expect(
      pickReport({ kind: 'add' }, venue, { ...added, name: ' Bar, "Nuevo" ' }),
    ).toEqual({
      kind: 'add',
      name: 'Bar Nuevo',
      venueKind: 'bar',
      terrace: true,
      ...venue,
    })
  })
})

describe('names', () => {
  it('accepts real names and refuses links and junk', () => {
    for (const name of ["Mesón O'Donnell", 'Café & Té', 'La Bodeguita nº 2'])
      expect(nameOk(name)).toBe(true)
    for (const name of ['B', '12345', 'www.spam.example', 'x'.repeat(61)])
      expect(nameOk(name)).toBe(false)
  })

  it('cleans like the API', () => {
    expect(cleanName(' a,\tb  "c" ')).toBe('a b c')
  })
})

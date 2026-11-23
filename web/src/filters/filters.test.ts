import { describe, expect, it } from 'vitest'
import { dayTrack } from '../sun/dayTrack.ts'
import { venueDay, venueStatus } from '../sun/venueStatus.ts'
import { calleMenacho, plazaAlta } from '../test/fixtures.ts'
import {
  applyFilters,
  DEFAULT_FILTERS,
  matchesQuery,
  normalize,
} from './filters.ts'

const track = dayTrack('2026-12-21')
const noTerrace = {
  ...calleMenacho,
  id: 'osm:node/9',
  name: 'Café Ñandú',
  terrace: null,
  horizon: null,
}
const statuses = [plazaAlta, calleMenacho, noTerrace].map((venue) =>
  venueStatus(venueDay(venue, track), 10 * 60),
)
const names = (list: typeof statuses) => list.map((s) => s.venue.name)

describe('search', () => {
  it('ignores case and accents', () => {
    expect(normalize('  Café ÑANDÚ ')).toBe('cafe nandu')
    expect(matchesQuery('Café Ñandú', 'nandu')).toBe(true)
    expect(matchesQuery('Café Ñandú', '')).toBe(true)
    expect(matchesQuery('Café Ñandú', 'bar')).toBe(false)
  })
})

describe('applyFilters', () => {
  it('shows only venues with a terrace by default', () => {
    expect(DEFAULT_FILTERS.onlyTerrace).toBe(true)
    expect(applyFilters(statuses, DEFAULT_FILTERS, '')).toHaveLength(2)
    expect(
      applyFilters(statuses, { ...DEFAULT_FILTERS, onlyTerrace: false }, ''),
    ).toHaveLength(3)
  })

  it('filters by sun, terrace and search', () => {
    expect(
      names(
        applyFilters(
          statuses,
          { ...DEFAULT_FILTERS, onlyTerrace: false, sunNow: true },
          '',
        ),
      ),
    ).toEqual([plazaAlta.name])
    expect(
      applyFilters(statuses, { ...DEFAULT_FILTERS, onlyTerrace: true }, ''),
    ).toHaveLength(2)
    const all = { ...DEFAULT_FILTERS, onlyTerrace: false }
    expect(names(applyFilters(statuses, all, 'ñandu'))).toEqual(['Café Ñandú'])
  })
})

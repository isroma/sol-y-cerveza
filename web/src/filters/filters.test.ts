import { describe, expect, it } from 'vitest'
import { demoValues } from '../demo/demo.ts'
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
  it('keeps everything by default', () => {
    expect(applyFilters(statuses, DEFAULT_FILTERS, '')).toHaveLength(3)
  })

  it('filters by sun, terrace and search', () => {
    expect(
      names(applyFilters(statuses, { ...DEFAULT_FILTERS, sunNow: true }, '')),
    ).toEqual([plazaAlta.name])
    expect(
      applyFilters(statuses, { ...DEFAULT_FILTERS, onlyTerrace: true }, ''),
    ).toHaveLength(2)
    expect(names(applyFilters(statuses, DEFAULT_FILTERS, 'ñandu'))).toEqual([
      'Café Ñandú',
    ])
  })

  it('filters by the demo price and rating', () => {
    const cheapest = Math.min(
      ...statuses.map((s) => demoValues(s.venue.id).priceCents),
    )
    const byPrice = applyFilters(
      statuses,
      { ...DEFAULT_FILTERS, maxPriceCents: cheapest },
      '',
    )
    expect(byPrice.length).toBeGreaterThan(0)
    expect(
      byPrice.every((s) => demoValues(s.venue.id).priceCents <= cheapest),
    ).toBe(true)
    expect(
      applyFilters(statuses, { ...DEFAULT_FILTERS, minRating: 5 }, ''),
    ).toHaveLength(0)
  })
})

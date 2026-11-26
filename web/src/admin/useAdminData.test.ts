import { describe, expect, it } from 'vitest'
import { plazaAlta } from '../test/fixtures.ts'
import type { Review } from './review.ts'
import { withAddedVenues } from './useAdminData.ts'

const added = (venueId: string, name: string): Review => ({
  venueId,
  status: null,
  name,
  kind: 'bar',
  venue: { lat: 38.8705, lon: -6.9837 },
  terrace: null,
  reviewed: '2026-11-26',
  looksRight: false,
})

describe('withAddedVenues', () => {
  it('adds the venues added in the admin, sorted by name', () => {
    const venues = withAddedVenues(
      [plazaAlta],
      [added('review:abaco', 'Ábaco')],
    )
    expect(venues.map((v) => v.id)).toEqual(['review:abaco', plazaAlta.id])
  })

  it('lists a published added venue once, as its dataset record', () => {
    const published = { ...plazaAlta, id: 'review:kalty', name: 'Kalty' }
    const venues = withAddedVenues(
      [published],
      [added('review:kalty', 'Kalty')],
    )
    expect(venues).toEqual([published])
  })
})

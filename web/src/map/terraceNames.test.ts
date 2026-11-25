import { describe, expect, it } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { farShare, terraceNamesData } from './terraceNames.ts'

const status = (
  id: string,
  category: VenueStatus['category'],
  hasTerrace = true,
): VenueStatus =>
  ({
    venue: {
      id,
      name: `Bar ${id}`,
      kind: 'bar',
      venue: { lat: 38.88, lon: -6.97 },
      terrace: { lat: 38.8801, lon: -6.9701 },
      sources: ['osm'],
      verified: null,
      horizon: null,
    },
    hasTerrace,
    category,
  }) as unknown as VenueStatus

describe('terraceNamesData', () => {
  it('names terrace badges, sunny ones marked, at the terrace', () => {
    const data = terraceNamesData(
      [status('a', 'sun'), status('b', 'nosun'), status('c', 'sun', false)],
      null,
      new Set(),
    )
    expect(
      data.features.map((f) => [f.properties.id, f.properties.sunny]),
    ).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(data.features[0]?.geometry.coordinates).toEqual([-6.9701, 38.8801])
  })

  it('leaves out the selected badge and names none showing a price', () => {
    const data = terraceNamesData(
      [status('a', 'sun'), status('b', 'sun')],
      'a',
      new Set(['b']),
    )
    expect(data.features.map((f) => f.properties)).toEqual([
      expect.objectContaining({ id: 'b', priced: true, named: false }),
    ])
  })
})

describe('farShare', () => {
  it('hides nothing looking down and up to 40 % of the screen tilted', () => {
    expect(farShare(0)).toBe(0)
    expect(farShare(30)).toBe(0)
    expect(farShare(60)).toBeCloseTo(0.35)
    expect(farShare(85)).toBe(0.4)
  })
})

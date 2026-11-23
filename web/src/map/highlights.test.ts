import { describe, expect, it } from 'vitest'
import type { SunState } from '../sun/sunState.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { highlightedIds, sunMinutesToday } from './highlights.ts'

function status(
  id: string,
  hasTerrace: boolean,
  sunSteps: number | null,
  category: VenueStatus['category'] = 'sun',
): VenueStatus {
  const timeline: SunState[] | null =
    sunSteps === null
      ? null
      : [...Array<SunState>(sunSteps).fill('sun'), 'shade', 'night']
  return {
    venue: {
      id,
      name: id,
      kind: 'bar',
      venue: { lat: 38.88, lon: -6.97 },
      terrace: hasTerrace ? { lat: 38.88, lon: -6.97 } : null,
      sources: ['osm'],
      verified: null,
      horizon: null,
    },
    hasTerrace,
    state: category === 'sun' ? 'sun' : 'shade',
    category,
    timeline,
    sunUntil: null,
    nextSun: null,
    minutesLeft: null,
    throughBareTrees: false,
  }
}

describe('sunMinutesToday', () => {
  it('counts the sunny steps of the day', () => {
    expect(sunMinutesToday(status('osm:node/1', true, 12))).toBe(60)
    expect(sunMinutesToday(status('osm:node/2', true, null))).toBe(0)
  })
})

describe('highlightedIds', () => {
  it('keeps sunny terraces only, the sunniest first', () => {
    const statuses = [
      status('osm:node/1', true, 10),
      status('osm:node/2', false, null),
      status('osm:node/3', true, 50),
      status('osm:node/4', true, 30),
      status('osm:node/5', true, 80, 'nosun'),
      status('osm:node/6', true, 70, 'soon'),
    ]
    expect([...highlightedIds(statuses, 2)]).toEqual([
      'osm:node/3',
      'osm:node/4',
    ])
    expect([...highlightedIds(statuses)]).toEqual([
      'osm:node/3',
      'osm:node/4',
      'osm:node/1',
    ])
  })
})

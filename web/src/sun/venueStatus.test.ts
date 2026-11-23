import { describe, expect, it } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import {
  calleMenacho,
  paseoSanFrancisco,
  plazaAlta,
  withoutHorizon,
} from '../test/fixtures.ts'
import { parseClock } from '../time/madrid.ts'
import { dayTrack, stepIndex } from './dayTrack.ts'
import {
  compareStatus,
  sunRuns,
  venueDay,
  venueStatus,
  type VenueStatus,
} from './venueStatus.ts'

const winter = dayTrack('2026-12-21')
const summer = dayTrack('2026-06-21')

function at(venue: Terrace, track: typeof winter, clock: string): VenueStatus {
  const minutes = parseClock(clock)
  if (minutes === null) throw new Error(clock)
  return venueStatus(venueDay(venue, track), minutes)
}

describe('dayTrack', () => {
  it('samples the whole day every 5 minutes', () => {
    expect(winter.positions).toHaveLength(288)
    expect(stepIndex(0)).toBe(0)
    expect(stepIndex(14 * 60 + 2)).toBe(168)
    expect(stepIndex(24 * 60)).toBe(287)
  })

  it('puts the sun south at midday and below the horizon at night', () => {
    const noon = winter.positions[stepIndex(13 * 60 + 40)]
    expect(noon?.azimuth).toBeGreaterThan(170)
    expect(noon?.azimuth).toBeLessThan(190)
    expect(winter.positions[0]?.altitude).toBeLessThan(0)
  })
})

describe('venueStatus', () => {
  it('knows until when a sunny terrace keeps the sun', () => {
    const status = at(plazaAlta, winter, '14:00')
    expect(status.state).toBe('sun')
    expect(status.category).toBe('sun')
    expect(status.sunUntil).toBe(17 * 60 + 15)
    expect(status.minutesLeft).toBe(195)
    expect(status.nextSun).toBeNull()
  })

  it('flags shade with sun arriving within an hour as "soon"', () => {
    const status = at(calleMenacho, winter, '11:30')
    expect(status.state).toBe('shade')
    expect(status.nextSun).toBe(12 * 60 + 10)
    expect(status.category).toBe('soon')
  })

  it('is "nosun" when the sun is further away or gone for the day', () => {
    expect(at(calleMenacho, winter, '10:00').category).toBe('nosun')
    const evening = at(calleMenacho, winter, '16:00')
    expect(evening.nextSun).toBeNull()
    expect(evening.category).toBe('nosun')
    expect(at(paseoSanFrancisco, winter, '14:00').minutesLeft).toBe(0)
  })

  it('is unknown without a horizon or a terrace', () => {
    const noHorizon = at(withoutHorizon, summer, '14:00')
    expect(noHorizon.category).toBe('unknown')
    expect(noHorizon.hasTerrace).toBe(true)
    const noTerrace = at(
      { ...plazaAlta, terrace: null, horizon: null },
      summer,
      '14:00',
    )
    expect(noTerrace.category).toBe('unknown')
    expect(noTerrace.hasTerrace).toBe(false)
  })

  it('sorts sunny, then soon, then by sun left', () => {
    const statuses = [
      at(withoutHorizon, winter, '11:30'),
      at(paseoSanFrancisco, winter, '11:30'),
      at(calleMenacho, winter, '11:30'),
      at(plazaAlta, winter, '11:30'),
    ].sort(compareStatus)
    expect(statuses.map((s) => s.category)).toEqual([
      'sun',
      'soon',
      'nosun',
      'unknown',
    ])
  })
})

describe('sunRuns', () => {
  it('lists the sunny stretches of the day', () => {
    const { timeline } = venueDay(calleMenacho, winter)
    expect(timeline && sunRuns(timeline)).toEqual([
      [12 * 60 + 10, 14 * 60 + 45],
    ])
  })

  it('closes a run that lasts until midnight', () => {
    expect(sunRuns(['shade', 'sun', 'sun'])).toEqual([[5, 15]])
  })
})

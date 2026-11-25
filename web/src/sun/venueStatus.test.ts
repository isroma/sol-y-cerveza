import { describe, expect, it } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import {
  calleMenacho,
  horizonFromRuns,
  packedFlat,
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

describe('leaf-off horizon (ADR-0007)', () => {
  // Paseo de San Francisco: 31° of crowns all around, 8.3° once they are bare.
  const bareInWinter = {
    ...paseoSanFrancisco,
    horizon_winter: horizonFromRuns([[0, 359, 83]]),
  }
  const april = dayTrack('2027-04-10')

  it('gives sun through bare trees inside the leaf-off period', () => {
    expect(at(paseoSanFrancisco, winter, '13:00').state).toBe('shade')
    const status = at(bareInWinter, winter, '13:00')
    expect(status.state).toBe('sun')
    // The same day as Plaza Alta, which has the same 8.3° horizon.
    expect(status.sunUntil).toBe(at(plazaAlta, winter, '13:00').sunUntil)
    expect(status.minutesLeft).toBe(at(plazaAlta, winter, '13:00').minutesLeft)
  })

  it('uses the full horizon outside the period', () => {
    expect(venueDay(bareInWinter, april).timeline).toEqual(
      venueDay(paseoSanFrancisco, april).timeline,
    )
  })

  it('behaves as before without a leaf-off horizon', () => {
    for (const venue of [plazaAlta, calleMenacho, paseoSanFrancisco]) {
      const day = venueDay({ ...venue, horizon_winter: null }, winter)
      expect(day.timeline).toEqual(venueDay(venue, winter).timeline)
    }
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

describe('venueStatus with an envelope (Sol parcial)', () => {
  const flat = (value: number) => new Array<number>(360).fill(value)
  // The pin sees 8.3°; across the terrace the obstacles run from 0° to 30°.
  const mixed: Terrace = {
    ...plazaAlta,
    horizon_low: packedFlat(0),
    horizon_high: packedFlat(30),
  }
  const partialAt = (venue: Terrace, track: typeof winter, clock: string) => {
    const minutes = parseClock(clock)
    if (minutes === null) throw new Error(clock)
    return venueStatus(venueDay(venue, track, { partial: true }), minutes)
  }
  /** First minute from `from` at which the sun is above `tenths`. */
  const firstAbove = (track: typeof winter, tenths: number, from = 0) =>
    track.positions.findIndex(
      (p, i) => i * 5 >= from && p.altitude * 10 > tenths,
    ) * 5
  const lastAbove = (track: typeof winter, tenths: number) =>
    (track.positions.findLastIndex((p) => p.altitude * 10 > tenths) + 1) * 5

  it('ignores the envelope without the flag', () => {
    expect(at(mixed, summer, '09:00')).toEqual({
      ...at(plazaAlta, summer, '09:00'),
      venue: mixed,
    })
    expect(at(mixed, summer, '09:00').category).toBe('sun')
  })

  it('is partial while the sun is between the lowest and highest obstacle', () => {
    const status = partialAt(mixed, summer, '08:30')
    expect(status.state).toBe('partial')
    expect(status.category).toBe('partial')
    expect(partialAt(mixed, summer, '14:30').category).toBe('sun')
  })

  it('ends "Sol hasta" at the last sun anywhere on the terrace', () => {
    const sunset = lastAbove(summer, 0)
    expect(partialAt(mixed, summer, '14:30').sunUntil).toBe(sunset)
    expect(partialAt(mixed, summer, '08:30').sunUntil).toBe(sunset)
  })

  it('starts "Sol en" at the first sun anywhere on the terrace', () => {
    const late: Terrace = {
      ...plazaAlta,
      horizon_low: packedFlat(15),
      horizon_high: packedFlat(30),
    }
    const status = partialAt(late, summer, '08:00')
    expect(status.category).not.toBe('sun')
    expect(status.nextSun).toBe(
      firstAbove(summer, 150, parseClock('08:00') ?? 0),
    )
  })

  it('counts partial minutes as sun left', () => {
    const status = partialAt(mixed, summer, '08:30')
    expect(status.minutesLeft).toBe(
      partialAt({ ...plazaAlta, horizon: flat(0) }, summer, '08:30')
        .minutesLeft,
    )
  })

  it('sorts partial after full sun and before sun soon', () => {
    const sun = partialAt(mixed, summer, '14:30')
    const partial = partialAt(mixed, summer, '08:30')
    const soon = { ...partial, category: 'soon' as const }
    expect([soon, partial, sun].sort(compareStatus)).toEqual([
      sun,
      partial,
      soon,
    ])
  })

  it('takes partial stretches into the sun spells', () => {
    const { timeline } = venueDay(mixed, summer, { partial: true })
    expect(timeline).not.toBeNull()
    expect(sunRuns(timeline ?? [])).toEqual([
      [firstAbove(summer, 0), lastAbove(summer, 0)],
    ])
  })
})

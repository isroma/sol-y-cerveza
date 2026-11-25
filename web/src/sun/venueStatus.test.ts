import { describe, expect, it } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import {
  calleMenacho,
  horizonFromRuns,
  packedFlat,
  paseoSanFrancisco,
  plazaAlta,
  sunCorrection,
  withoutHorizon,
} from '../test/fixtures.ts'
import { formatClock, parseClock } from '../time/madrid.ts'
import { dayTrack, stepIndex } from './dayTrack.ts'
import { sunState } from './sunState.ts'
import { correctionsByVenue } from './corrections.ts'
import {
  compareStatus,
  correctDays,
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

describe('venueStatus with an envelope', () => {
  const flat = (value: number) => new Array<number>(360).fill(value)
  // The pin sees 8.3°; across the terrace the lowest obstacle is 15°.
  const mixed: Terrace = {
    ...plazaAlta,
    horizon_low: packedFlat(15),
  }
  /** The same day for a terrace whose only obstacle is `tenths` high. */
  const open = (tenths: number, clock: string) =>
    at({ ...plazaAlta, horizon: flat(tenths) }, summer, clock)

  it('is in sun when any part of the terrace is: the low envelope answers', () => {
    for (const clock of ['07:30', '08:30', '09:00', '14:30', '20:30']) {
      expect(at(mixed, summer, clock)).toEqual({
        ...open(150, clock),
        venue: mixed,
      })
    }
    expect(at(mixed, summer, '08:30').state).not.toBe(
      at(plazaAlta, summer, '08:30').state,
    )
  })

  it('takes "Sol hasta" and "Sol en" from the first and last sun anywhere', () => {
    const noon = at(mixed, summer, '14:30')
    expect(noon.category).toBe('sun')
    expect(noon.sunUntil).toBe(open(150, '14:30').sunUntil)
    expect(at(mixed, summer, '07:30').nextSun).toBe(open(150, '07:30').nextSun)
  })

  it('follows the single horizon with a malformed envelope', () => {
    const broken: Terrace = { ...mixed, horizon_low: 'x' }
    expect(at(broken, summer, '08:30')).toEqual({
      ...at(plazaAlta, summer, '08:30'),
      venue: broken,
    })
  })
})

describe('venueStatus with a short shade gap', () => {
  const clockOf = (minutes: number) => formatClock(minutes)
  // A thin obstacle (a lamp post) due south: 3° wide, up to 80°, so the
  // midday sun crosses it in under 20 minutes in summer.
  const post: Terrace = {
    ...plazaAlta,
    horizon: horizonFromRuns([
      [0, 359, 50],
      [179, 181, 800],
    ]),
  }

  it('counts the gap as sun: one spell, sun all through it', () => {
    const horizon = post.horizon ?? []
    const raw = summer.positions.map((p) => sunState(horizon, p))
    // The raw midday gap behind the post: 1 to 3 steps of shade with the sun high.
    const gap = raw.flatMap((state, i) =>
      state === 'shade' && (summer.positions[i]?.altitude ?? 0) > 30 ? [i] : [],
    )
    expect(gap.length).toBeGreaterThan(0)
    expect(gap.length).toBeLessThanOrEqual(3)

    const timeline = venueDay(post, summer).timeline ?? []
    expect(gap.every((i) => timeline[i] === 'sun')).toBe(true)
    expect(sunRuns(timeline)).toHaveLength(1)
    const inGap = at(post, summer, clockOf((gap[0] ?? 0) * 5))
    expect(inGap.category).toBe('sun')
    expect(inGap.sunUntil).toBe(sunRuns(timeline)[0]?.[1])
    expect(inGap.minutesLeft).toBe(
      timeline.slice(gap[0]).filter((s) => s === 'sun').length * 5,
    )
  })
})

describe("visitors' sun corrections", () => {
  // Under trees, 31° all round: no sun at all at the winter solstice, when
  // the sun peaks near 28°. Visitors saw sun around the south at midday.
  const shady = paseoSanFrancisco
  const south = (patch: Parameters<typeof sunCorrection>[0] = {}) =>
    sunCorrection({
      venueId: shady.id,
      leafOff: true,
      from: 160,
      to: 200,
      altitude: 200,
      ...patch,
    })

  it('adds the sun visitors saw, marked as approximate', () => {
    expect(at(shady, winter, '13:40').state).toBe('shade')
    const day = venueDay(shady, winter, [south()])
    const status = venueStatus(day, parseClock('13:40') ?? 0)
    expect(status.state).toBe('sun')
    expect(status.byVisitors).toBe(true)
    const approximate = status.approximate ?? []
    // Every sunny step leans on the visitors, and only those.
    expect(
      (status.timeline ?? []).every((s, i) => (s === 'sun') === approximate[i]),
    ).toBe(true)
  })

  it("marks the next sun as the visitors' while in shade before it", () => {
    const status = venueStatus(
      venueDay(shady, winter, [south()]),
      parseClock('10:00') ?? 0,
    )
    expect(status.state).toBe('shade')
    expect(status.nextSun).not.toBeNull()
    expect(status.byVisitors).toBe(true)
  })

  it('shows confirmed corrections as plain sun', () => {
    const day = venueDay(shady, winter, [south({ confirmed: true })])
    expect(day.timeline).toContain('sun')
    expect(day.approximate).toBeNull()
    expect(venueStatus(day, parseClock('13:40') ?? 0).byVisitors).toBe(false)
  })

  it('is confirmed only where the confirmed cap alone gives sun', () => {
    // Confirmed sun in a narrow slice, visitors' in a wider one.
    const narrow = south({ confirmed: true, from: 175, to: 190 })
    const sure = venueDay(shady, winter, [narrow]).timeline ?? []
    const day = venueDay(shady, winter, [narrow, south()])
    const approximate = day.approximate ?? []
    expect(sure).toContain('sun')
    sure.forEach((state, i) => {
      if (state === 'sun') expect(approximate[i]).toBe(false)
    })
    expect(approximate.some(Boolean)).toBe(true)
  })

  it('ignores corrections from the other season', () => {
    const day = venueDay(shady, winter, [south({ leafOff: false })])
    expect(day.timeline).not.toContain('sun')
    expect(day.approximate).toBeNull()
  })

  it('caps the envelope when the terrace has one', () => {
    const enveloped: Terrace = { ...shady, horizon_low: packedFlat(30) }
    expect(venueDay(enveloped, winter).timeline).not.toContain('sun')
    expect(venueDay(enveloped, winter, [south()]).timeline).toContain('sun')
  })

  it('caps the leaf-off horizon when it answers', () => {
    const leafless: Terrace = {
      ...shady,
      horizon: horizonFromRuns([[0, 359, 50]]),
      horizon_winter: horizonFromRuns([[0, 359, 310]]),
    }
    expect(venueDay(leafless, winter).timeline).not.toContain('sun')
    expect(venueDay(leafless, winter, [south()]).timeline).toContain('sun')
  })

  it('marks short shade bridged only by visitors as approximate', () => {
    // A block to the south hides the midday sun for about an hour; visitors
    // saw sun over most of it, leaving a gap short enough to count as sun.
    const post: Terrace = {
      ...plazaAlta,
      horizon: horizonFromRuns([
        [0, 359, 50],
        [160, 200, 800],
      ]),
    }
    const plain = venueDay(post, summer).timeline ?? []
    const corrected = venueDay(post, summer, [
      sunCorrection({ venueId: post.id, from: 160, to: 190, altitude: 400 }),
    ])
    const timeline = corrected.timeline ?? []
    const approximate = corrected.approximate ?? []
    const gained = timeline.flatMap((s, i) =>
      s === 'sun' && plain[i] !== 'sun' ? [i] : [],
    )
    expect(gained.length).toBeGreaterThan(0)
    expect(gained.every((i) => approximate[i])).toBe(true)
  })

  it('recomputes only the venues with corrections', () => {
    const days = [venueDay(shady, winter), venueDay(plazaAlta, winter)]
    expect(correctDays(days, new Map(), winter)).toBe(days)
    const corrected = correctDays(days, correctionsByVenue([south()]), winter)
    expect(corrected[0]).not.toBe(days[0])
    expect(corrected[0]?.timeline).toContain('sun')
    expect(corrected[1]).toBe(days[1])
  })
})

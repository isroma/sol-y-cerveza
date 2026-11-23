import { describe, expect, it } from 'vitest'
import { dayTrack } from '../sun/dayTrack.ts'
import {
  horizonFromRuns,
  paseoSanFrancisco,
  plazaAlta,
  withoutHorizon,
} from '../test/fixtures.ts'
import { lookReasons, needsALook, referenceDates } from './needsLook.ts'

const tracks = referenceDates('2026-11-23').map(dayTrack)

describe('referenceDates', () => {
  it('is today and both solstices, once each', () => {
    expect(referenceDates('2026-11-23')).toEqual([
      '2026-11-23',
      '2026-06-21',
      '2026-12-21',
    ])
    expect(referenceDates('2026-06-21')).toEqual(['2026-06-21', '2026-12-21'])
  })
})

describe('lookReasons', () => {
  it('passes an open square and trees at 31°', () => {
    expect(lookReasons(plazaAlta.horizon, tracks)).toEqual([])
    expect(lookReasons(paseoSanFrancisco.horizon, tracks)).toEqual([])
  })

  it('flags a pin against a wall: 60–74° over the whole southern arc', () => {
    // The McCafé case from #161: a terrace pinned 27 m from its venue. The
    // June noon sun (74.6°) still clears it, so only the south check trips.
    const horizon = horizonFromRuns([
      [60, 120, 600],
      [121, 240, 740],
      [241, 300, 650],
    ])
    expect(lookReasons(horizon, tracks)).toEqual(['high_south'])
  })

  it('flags no sun on any reference day', () => {
    expect(lookReasons(horizonFromRuns([[0, 359, 800]]), tracks)).toEqual([
      'no_sun',
      'high_south',
    ])
    // 70° to the south: sun at midsummer noon only, which is enough.
    const summerOnly = horizonFromRuns([[0, 359, 700]])
    expect(lookReasons(summerOnly, tracks)).not.toContain('no_sun')
  })

  it('needs more than half the south above 60°', () => {
    const half = horizonFromRuns([[90, 179, 700]])
    expect(lookReasons(half, tracks)).not.toContain('high_south')
    const most = horizonFromRuns([[90, 180, 700]])
    expect(lookReasons(most, tracks)).toContain('high_south')
  })
})

describe('needsALook', () => {
  it('lists only venues with a terrace and a suspicious horizon', () => {
    const walled = {
      ...plazaAlta,
      id: 'osm:node/1',
      horizon: horizonFromRuns([[0, 359, 900]]),
    }
    const noTerrace = { ...walled, id: 'osm:node/2', terrace: null }
    expect(
      needsALook([plazaAlta, walled, noTerrace, withoutHorizon], tracks),
    ).toEqual([{ venue: walled, reasons: ['no_sun', 'high_south'] }])
  })
})

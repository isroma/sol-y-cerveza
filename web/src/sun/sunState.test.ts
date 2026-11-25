import { describe, expect, it } from 'vitest'
import {
  calleMenacho,
  horizonFromRuns,
  paseoSanFrancisco,
  plazaAlta,
} from '../test/fixtures.ts'
import { fromMadridLocal } from '../time/madrid.ts'
import {
  fillShortShade,
  horizonBin,
  sunPosition,
  sunState,
  type SunState,
} from './sunState.ts'

const madrid = (date: string, time: string) => {
  const [hours = 0, minutes = 0] = time.split(':').map(Number)
  return fromMadridLocal(date, hours * 60 + minutes)
}

describe('sunPosition', () => {
  it('returns a compass azimuth: east in the morning, south at noon, west in the evening', () => {
    const at = (time: string) =>
      sunPosition(madrid('2026-06-21', time), plazaAlta.terrace).azimuth
    expect(at('09:00')).toBeGreaterThan(60)
    expect(at('09:00')).toBeLessThan(100)
    expect(at('14:30')).toBeCloseTo(180, -1)
    expect(at('20:00')).toBeGreaterThan(260)
    expect(at('20:00')).toBeLessThan(300)
  })

  it('matches the expected position at Plaza Alta on the solstices, 14:00', () => {
    const summer = sunPosition(madrid('2026-06-21', '14:00'), plazaAlta.terrace)
    expect(summer.altitude).toBeCloseTo(73.3, 0)
    expect(summer.azimuth).toBeCloseTo(155.6, 0)

    const winter = sunPosition(madrid('2026-12-21', '14:00'), plazaAlta.terrace)
    expect(winter.altitude).toBeCloseTo(27.2, 0)
    expect(winter.azimuth).toBeCloseTo(188.8, 0)
  })
})

describe('horizonBin', () => {
  it.each([
    [0, 0],
    [0.49, 0],
    [89.5, 90],
    [359.4, 359],
    [359.6, 0],
    [360, 0],
  ])('puts azimuth %f in bin %i', (azimuth, bin) => {
    expect(horizonBin(azimuth)).toBe(bin)
  })
})

describe('sunState', () => {
  // A 90° wall to the north (bin 0 only), open sky everywhere else.
  const northWall = horizonFromRuns([[0, 0, 900]])
  const flat = horizonFromRuns([[0, 359, 100]]) // 10° all around

  it('is night when the sun is at or below the horizon line', () => {
    expect(sunState(flat, { altitude: 0, azimuth: 180 })).toBe('night')
    expect(sunState(flat, { altitude: -12, azimuth: 180 })).toBe('night')
  })

  it('is night rather than unknown when the horizon is missing at night', () => {
    expect(sunState(null, { altitude: -1, azimuth: 180 })).toBe('night')
  })

  it('is unknown when the horizon is missing by day', () => {
    expect(sunState(null, { altitude: 30, azimuth: 180 })).toBe('unknown')
  })

  it('is sun only when the sun is strictly above the obstacle', () => {
    expect(sunState(flat, { altitude: 10.1, azimuth: 180 })).toBe('sun')
    expect(sunState(flat, { altitude: 10, azimuth: 180 })).toBe('shade')
    expect(sunState(flat, { altitude: 5, azimuth: 180 })).toBe('shade')
  })

  it('looks up the bin of the rounded azimuth, wrapping at north', () => {
    expect(sunState(northWall, { altitude: 45, azimuth: 359.6 })).toBe('shade')
    expect(sunState(northWall, { altitude: 45, azimuth: 0.4 })).toBe('shade')
    expect(sunState(northWall, { altitude: 45, azimuth: 359.4 })).toBe('sun')
    expect(sunState(northWall, { altitude: 45, azimuth: 0.6 })).toBe('sun')
  })

  it.each([
    ['2026-06-21', '14:00', plazaAlta, 'sun'],
    ['2026-06-21', '14:00', calleMenacho, 'sun'], // 73° clears the 66.5° walls
    ['2026-06-21', '10:00', calleMenacho, 'shade'],
    ['2026-06-21', '14:00', paseoSanFrancisco, 'sun'],
    ['2026-06-21', '23:00', plazaAlta, 'night'],
    ['2026-12-21', '14:00', plazaAlta, 'sun'],
    ['2026-12-21', '14:00', calleMenacho, 'sun'], // sun down the street axis
    ['2026-12-21', '14:00', paseoSanFrancisco, 'shade'], // 27° < 31°
  ])('on %s at %s, %s is %s', (date, time, terrace, expected) => {
    const position = sunPosition(madrid(date, time), terrace.terrace)
    expect(sunState(terrace.horizon, position)).toBe(expected)
  })
})

describe('fillShortShade', () => {
  /** "n" night, "s" sun, "." shade, one character per 5-minute step. */
  const parse = (text: string): SunState[] =>
    [...text].map((c) => (c === 's' ? 'sun' : c === 'n' ? 'night' : 'shade'))
  const fill = (text: string) =>
    fillShortShade(parse(text))
      .map((s) => (s === 'sun' ? 's' : s === 'night' ? 'n' : '.'))
      .join('')

  it('turns shade of up to 15 minutes between sun into sun', () => {
    expect(fill('nn..ss.ss..ss...ss..nn')).toBe('nn..ssssssssssssss..nn')
  })

  it('keeps longer gaps, like a tower that hides the sun for 25 minutes', () => {
    expect(fill('ss....ss')).toBe('ss....ss')
    expect(fill('ss.....ss')).toBe('ss.....ss')
  })

  it('keeps shade before the first sun and after the last', () => {
    expect(fill('n...ss.ss...n')).toBe('n...sssss...n')
    expect(fill('...')).toBe('...')
  })

  it('keeps a gap with night in it', () => {
    expect(fill('s.n.s')).toBe('s.n.s')
  })
})

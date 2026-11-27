import { describe, expect, it } from 'vitest'
import {
  paseoSanFrancisco,
  plazaAlta,
  sunCorrection,
  withoutHorizon,
} from '../test/fixtures.ts'
import { canReportSun, reportableSky } from './reportable.ts'

// 13:40 in Madrid at the winter solstice: the sun is about 28° up, south.
const NOON = new Date('2026-12-21T12:40:00Z')
// 08:40 the same day: the sun has just risen, under 2° up.
const DAWN = new Date('2026-12-21T07:40:00Z')

describe('canReportSun', () => {
  it('offers it where the app says shade with the sun up', () => {
    expect(canReportSun(paseoSanFrancisco, [], NOON)).toBe(true)
  })

  it('not where the app already says sun', () => {
    expect(canReportSun(plazaAlta, [], NOON)).toBe(false)
  })

  it("not once visitors' corrections already give sun now", () => {
    const corrections = [
      sunCorrection({
        venueId: paseoSanFrancisco.id,
        leafOff: true,
        from: 160,
        to: 200,
        altitude: 200,
      }),
    ]
    expect(canReportSun(paseoSanFrancisco, corrections, NOON)).toBe(false)
  })

  it('not where an accepted correction in the data already gives sun', () => {
    const accepted = {
      ...paseoSanFrancisco,
      sun_corrections: [{ leaf_off: true, from: 160, to: 200, altitude: 200 }],
    }
    expect(canReportSun(accepted, [], NOON)).toBe(false)
  })

  it('not with the sun under 2°, nor without a horizon or a terrace', () => {
    expect(canReportSun(paseoSanFrancisco, [], DAWN)).toBe(false)
    expect(canReportSun(withoutHorizon, [], NOON)).toBe(false)
    expect(
      canReportSun({ ...paseoSanFrancisco, terrace: null }, [], NOON),
    ).toBe(false)
  })
})

describe('reportableSky', () => {
  it('offers sun where the app says shade, and shade where it says sun', () => {
    expect(reportableSky(paseoSanFrancisco, [], NOON)).toBe('sun')
    expect(reportableSky(plazaAlta, [], NOON)).toBe('shade')
  })

  it('offers nothing with the sun under 2°', () => {
    expect(reportableSky(plazaAlta, [], DAWN)).toBeNull()
  })

  it('offers sun again once a floor in the data puts the terrace in shade', () => {
    const shaded = {
      ...plazaAlta,
      shade_corrections: [{ leaf_off: true, from: 0, to: 359, altitude: 900 }],
    }
    expect(reportableSky(shaded, [], NOON)).toBe('sun')
  })
})

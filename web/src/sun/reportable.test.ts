import { describe, expect, it } from 'vitest'
import {
  paseoSanFrancisco,
  plazaAlta,
  sunCorrection,
  withoutHorizon,
} from '../test/fixtures.ts'
import { canReportSun } from './reportable.ts'

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

  it('not with the sun under 2°, nor without a horizon or a terrace', () => {
    expect(canReportSun(paseoSanFrancisco, [], DAWN)).toBe(false)
    expect(canReportSun(withoutHorizon, [], NOON)).toBe(false)
    expect(
      canReportSun({ ...paseoSanFrancisco, terrace: null }, [], NOON),
    ).toBe(false)
  })
})

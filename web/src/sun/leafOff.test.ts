import { describe, expect, it } from 'vitest'
import { packDegrees, packedFlat } from '../test/fixtures.ts'
import {
  envelopeFor,
  horizonFor,
  isLeafOff,
  unpackEnvelope,
} from './leafOff.ts'

describe('isLeafOff', () => {
  it.each([
    ['2026-12-01', true],
    ['2026-12-31', true],
    ['2027-01-01', true],
    ['2028-02-29', true],
    ['2027-03-15', true],
    ['2026-11-30', false],
    ['2026-11-23', false],
    ['2027-03-16', false],
    ['2027-06-21', false],
    ['not a date', false],
  ])('%s → %s', (date, expected) => {
    expect(isLeafOff(date)).toBe(expected)
  })
})

describe('horizonFor', () => {
  const full = Array<number>(360).fill(300)
  const bare = Array<number>(360).fill(100)

  it('uses the leaf-off horizon only inside the period', () => {
    const venue = { horizon: full, horizon_winter: bare }
    expect(horizonFor(venue, '2027-01-10')).toBe(bare)
    expect(horizonFor(venue, '2027-04-10')).toBe(full)
  })

  it('falls back to the full horizon when there is no leaf-off one', () => {
    expect(
      horizonFor({ horizon: full, horizon_winter: null }, '2027-01-10'),
    ).toBe(full)
    expect(horizonFor({ horizon: full }, '2027-01-10')).toBe(full)
  })

  it('has nothing without a horizon', () => {
    expect(horizonFor({ horizon: null }, '2027-01-10')).toBeNull()
  })
})

describe('unpackEnvelope', () => {
  it('reads whole degrees back as tenths', () => {
    const degrees = Array.from({ length: 360 }, (_, i) => i % 91)
    const envelope = unpackEnvelope(packDegrees(degrees), packedFlat(90))
    expect(envelope?.low).toEqual(degrees.map((d) => d * 10))
    expect(envelope?.high).toEqual(new Array<number>(360).fill(900))
  })

  it('rejects a wrong length, a bad character or low above high', () => {
    expect(unpackEnvelope(packedFlat(1).slice(1), packedFlat(2))).toBeNull()
    expect(unpackEnvelope('\\'.repeat(360), packedFlat(2))).toBeNull()
    expect(unpackEnvelope(packedFlat(5), packedFlat(4))).toBeNull()
  })
})

describe('envelopeFor', () => {
  const tenths = (degrees: number) => new Array<number>(360).fill(degrees * 10)
  const venue = {
    horizon: tenths(1),
    horizon_low: packedFlat(1),
    horizon_high: packedFlat(9),
    horizon_low_winter: packedFlat(0),
    horizon_high_winter: packedFlat(5),
  }

  it('uses the leaf-off envelope only in the leaf-off period', () => {
    expect(envelopeFor(venue, '2026-06-21')).toEqual({
      low: tenths(1),
      high: tenths(9),
    })
    expect(envelopeFor(venue, '2026-12-21')).toEqual({
      low: tenths(0),
      high: tenths(5),
    })
  })

  it('falls back to the summer envelope without a leaf-off one', () => {
    const summerOnly = {
      ...venue,
      horizon_low_winter: null,
      horizon_high_winter: null,
    }
    expect(envelopeFor(summerOnly, '2026-12-21')).toEqual({
      low: tenths(1),
      high: tenths(9),
    })
  })

  it('is null without an envelope or a horizon', () => {
    expect(envelopeFor({ horizon: tenths(1) }, '2026-06-21')).toBeNull()
    expect(envelopeFor({ ...venue, horizon: null }, '2026-06-21')).toBeNull()
  })
})

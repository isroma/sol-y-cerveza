import { describe, expect, it } from 'vitest'
import { packDegrees, packedFlat } from '../test/fixtures.ts'
import {
  anySunHorizon,
  horizonFor,
  isLeafOff,
  setLeafOffSeen,
  unpackHorizon,
} from './leafOff.ts'

describe('isLeafOff', () => {
  it.each([
    ['2026-12-01', true],
    ['2026-12-31', true],
    ['2027-01-01', true],
    ['2028-02-29', true],
    ['2027-04-15', true],
    ['2026-11-30', false],
    ['2026-11-23', false],
    ['2027-04-16', false],
    ['2027-06-21', false],
    ['not a date', false],
  ])('without seen dates, %s → %s', (date, expected) => {
    expect(isLeafOff(date, {})).toBe(expected)
  })

  const seen = { leaf_off_from: '2026-11-23', leaf_off_until: '2027-04-08' }

  it.each([
    ['2026-11-22', false],
    ['2026-11-23', true],
    ['2027-04-07', true],
    ['2027-04-08', false],
    // Another season: the seen dates don't apply, the fixed ones do.
    ['2027-11-23', false],
    ['2027-12-01', true],
  ])('from the seen dates, %s → %s', (date, expected) => {
    expect(isLeafOff(date, seen)).toBe(expected)
  })

  it.each([
    [{ leaf_off_from: '2026-09-15' }, '2026-09-20', false], // before 1 Oct
    [{ leaf_off_from: '2026-12-10' }, '2026-12-05', true], // after 1 Dec
    [{ leaf_off_until: '2027-02-20' }, '2027-02-25', true], // before 1 Mar
    [{ leaf_off_until: '2027-05-01' }, '2027-04-20', false], // after 15 Apr
    [{ leaf_off_from: '23/11/2026' }, '2026-11-25', false],
  ])('ignores %o outside the windows (%s → %s)', (seen, date, expected) => {
    expect(isLeafOff(date, seen)).toBe(expected)
  })

  it('follows the dates of the loaded data', () => {
    setLeafOffSeen({ leaf_off_from: '2026-11-23' })
    expect(isLeafOff('2026-11-25')).toBe(true)
    setLeafOffSeen({})
    expect(isLeafOff('2026-11-25')).toBe(false)
  })
})

describe('horizonFor', () => {
  const full = Array<number>(360).fill(300)
  const bare = Array<number>(360).fill(100)

  it('uses the leaf-off horizon only inside the period', () => {
    const venue = { horizon: full, horizon_winter: bare }
    expect(horizonFor(venue, '2027-01-10')).toBe(bare)
    expect(horizonFor(venue, '2027-04-20')).toBe(full)
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

describe('unpackHorizon', () => {
  it('reads whole degrees back as tenths', () => {
    const degrees = Array.from({ length: 360 }, (_, i) => i % 91)
    expect(unpackHorizon(packDegrees(degrees))).toEqual(
      degrees.map((d) => d * 10),
    )
  })

  it('rejects a wrong length or a bad character', () => {
    expect(unpackHorizon(packedFlat(1).slice(1))).toBeNull()
    expect(unpackHorizon('\\'.repeat(360))).toBeNull()
    expect(unpackHorizon('"'.repeat(360))).toBeNull()
  })
})

describe('anySunHorizon', () => {
  const tenths = (degrees: number) => new Array<number>(360).fill(degrees * 10)
  const venue = {
    horizon: tenths(3),
    horizon_low: packedFlat(1),
    horizon_low_winter: packedFlat(0),
  }

  it('is the low envelope, the leaf-off one only in the leaf-off period', () => {
    expect(anySunHorizon(venue, '2026-06-21')).toEqual(tenths(1))
    expect(anySunHorizon(venue, '2026-12-21')).toEqual(tenths(0))
  })

  it('falls back to the summer envelope without a leaf-off one', () => {
    expect(
      anySunHorizon({ ...venue, horizon_low_winter: null }, '2026-12-21'),
    ).toEqual(tenths(1))
  })

  it('is null without an envelope, with a malformed one or without a horizon', () => {
    expect(anySunHorizon({ horizon: tenths(1) }, '2026-06-21')).toBeNull()
    expect(
      anySunHorizon({ ...venue, horizon_low: 'x' }, '2026-06-21'),
    ).toBeNull()
    expect(anySunHorizon({ ...venue, horizon: null }, '2026-06-21')).toBeNull()
  })
})

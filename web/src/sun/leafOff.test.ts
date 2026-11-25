import { describe, expect, it } from 'vitest'
import { envelopeFor, horizonFor, isLeafOff } from './leafOff.ts'

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

describe('envelopeFor', () => {
  const low = new Array<number>(360).fill(10)
  const high = new Array<number>(360).fill(90)
  const lowWinter = new Array<number>(360).fill(5)
  const highWinter = new Array<number>(360).fill(50)
  const venue = {
    horizon: low,
    horizon_low: low,
    horizon_high: high,
    horizon_low_winter: lowWinter,
    horizon_high_winter: highWinter,
  }

  it('uses the leaf-off envelope only in the leaf-off period', () => {
    expect(envelopeFor(venue, '2026-06-21')).toEqual({ low, high })
    expect(envelopeFor(venue, '2026-12-21')).toEqual({
      low: lowWinter,
      high: highWinter,
    })
  })

  it('falls back to the summer envelope without a leaf-off one', () => {
    const summerOnly = {
      ...venue,
      horizon_low_winter: null,
      horizon_high_winter: null,
    }
    expect(envelopeFor(summerOnly, '2026-12-21')).toEqual({ low, high })
  })

  it('is null without an envelope or a horizon', () => {
    expect(envelopeFor({ horizon: low }, '2026-06-21')).toBeNull()
    expect(envelopeFor({ ...venue, horizon: null }, '2026-06-21')).toBeNull()
  })
})

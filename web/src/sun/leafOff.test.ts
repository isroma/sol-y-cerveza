import { describe, expect, it } from 'vitest'
import { horizonFor, isLeafOff } from './leafOff.ts'

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

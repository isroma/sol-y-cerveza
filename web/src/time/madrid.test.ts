import { describe, expect, it } from 'vitest'
import {
  formatClock,
  formatDuration,
  fromMadridLocal,
  MINUTES_PER_DAY,
  parseClock,
  toMadridLocal,
} from './madrid.ts'

describe('fromMadridLocal', () => {
  it.each([
    ['2026-06-21', 14 * 60, '2026-06-21T12:00:00.000Z'], // CEST, UTC+2
    ['2026-12-21', 14 * 60, '2026-12-21T13:00:00.000Z'], // CET, UTC+1
    ['2026-03-29', 90, '2026-03-29T00:30:00.000Z'], // before the spring change
    ['2026-03-29', 3 * 60 + 30, '2026-03-29T01:30:00.000Z'], // after it
    ['2026-10-25', 4 * 60, '2026-10-25T03:00:00.000Z'], // after the autumn change
    ['2026-03-29', MINUTES_PER_DAY, '2026-03-29T22:00:00.000Z'], // 23 h day
    ['2026-10-25', MINUTES_PER_DAY, '2026-10-25T23:00:00.000Z'], // 25 h day
  ])('maps %s + %i min to %s', (date, minutes, expected) => {
    expect(fromMadridLocal(date, minutes).toISOString()).toBe(expected)
  })

  it('rejects a malformed date', () => {
    expect(() => fromMadridLocal('21/06/2026', 0)).toThrow(RangeError)
  })
})

describe('toMadridLocal', () => {
  it('reads the wall clock in Madrid, not in the runtime time zone', () => {
    expect(toMadridLocal(new Date('2026-06-21T22:30:00Z'))).toEqual({
      date: '2026-06-22',
      minutes: 30,
    })
    expect(toMadridLocal(new Date('2026-12-21T13:05:00Z'))).toEqual({
      date: '2026-12-21',
      minutes: 14 * 60 + 5,
    })
  })
})

describe('clock helpers', () => {
  it('formats and parses HH:MM', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(14 * 60 + 5)).toBe('14:05')
    expect(parseClock('14:05')).toBe(14 * 60 + 5)
    expect(parseClock('24:00')).toBeNull()
    expect(parseClock('')).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(120)).toBe('2 h')
    expect(formatDuration(195)).toBe('3 h 15 min')
  })
})

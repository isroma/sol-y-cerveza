import { describe, expect, it } from 'vitest'
import { dayTrack } from '../sun/dayTrack.ts'
import { calleMenacho, horizonFromRuns } from '../test/fixtures.ts'
import { MINUTES_PER_DAY } from '../time/madrid.ts'
import { describeSun, stretches, sunSummary } from './sunSummary.ts'

const june = dayTrack('2026-06-21')

describe('sunSummary', () => {
  it('counts all daylight as sun with an open horizon', () => {
    const summary = sunSummary(horizonFromRuns([]), june)
    const [run] = summary.runs
    expect(summary.runs).toHaveLength(1)
    expect(run?.[1]).toBeDefined()
    expect(summary.minutes).toBe((run?.[1] ?? 0) - (run?.[0] ?? 0))
    // Badajoz on the summer solstice: about 14 h 50 min of daylight.
    expect(summary.minutes).toBeGreaterThan(14 * 60)
    expect(summary.timeline).toHaveLength(MINUTES_PER_DAY / 5)
  })

  it('finds no sun behind a 90° wall all around', () => {
    const summary = sunSummary(horizonFromRuns([[0, 359, 900]]), june)
    expect(summary.minutes).toBe(0)
    expect(summary.runs).toEqual([])
    expect(describeSun(summary)).toBe('No sun')
  })

  it('describes a narrow street as one window around noon', () => {
    const summary = sunSummary(calleMenacho.horizon, june)
    expect(summary.runs).toHaveLength(1)
    expect(describeSun(summary)).toMatch(
      /^\d h( \d+ min)? of sun · 1\d:\d\d–1\d:\d\d$/,
    )
  })
})

describe('stretches', () => {
  it('merges equal neighbours and covers the whole day', () => {
    expect(stretches(['night', 'night', 'shade', 'sun', 'sun'])).toEqual([
      { state: 'night', start: 0, end: 10 },
      { state: 'shade', start: 10, end: 15 },
      { state: 'sun', start: 15, end: 25 },
    ])
    const day = stretches(sunSummary(calleMenacho.horizon, june).timeline)
    expect(day[0]?.start).toBe(0)
    expect(day.at(-1)?.end).toBe(MINUTES_PER_DAY)
  })
})

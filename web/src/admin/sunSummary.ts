import type { DayTrack } from '../sun/dayTrack.ts'
import { STEP_MINUTES, sunState, type SunState } from '../sun/sunState.ts'
import { sunRuns } from '../sun/venueStatus.ts'
import { formatClock, formatDuration } from '../time/madrid.ts'

/** One day at one horizon, as the app would show it. */
export type SunSummary = {
  /** Per-step states, `timeline[i]` at minute `i * STEP_MINUTES` (see DayTrack). */
  timeline: SunState[]
  /** Minutes of sun over the whole day. */
  minutes: number
  /** Sun windows as [startMinute, endMinute). */
  runs: [number, number][]
}

/** A stretch of the day in one state, for the 24 h strip. */
export type Stretch = { state: SunState; start: number; end: number }

export function sunSummary(
  horizon: readonly number[],
  track: DayTrack,
): SunSummary {
  const timeline = track.positions.map((p) => sunState(horizon, p))
  const minutes =
    timeline.filter((state) => state === 'sun').length * STEP_MINUTES
  return { timeline, minutes, runs: sunRuns(timeline) }
}

/** "3 h 20 min of sun · 11:10–14:30, 16:00–17:05", or "No sun". */
export function describeSun(summary: SunSummary): string {
  if (summary.minutes === 0) return 'No sun'
  const windows = summary.runs
    .map(([start, end]) => `${formatClock(start)}–${formatClock(end)}`)
    .join(', ')
  return `${formatDuration(summary.minutes)} of sun · ${windows}`
}

/** Consecutive steps in the same state, merged. */
export function stretches(timeline: readonly SunState[]): Stretch[] {
  const out: Stretch[] = []
  timeline.forEach((state, i) => {
    const last = out.at(-1)
    const minute = i * STEP_MINUTES
    if (last && last.state === state) last.end = minute + STEP_MINUTES
    else out.push({ state, start: minute, end: minute + STEP_MINUTES })
  })
  return out
}

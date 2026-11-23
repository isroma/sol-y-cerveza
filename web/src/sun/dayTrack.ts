import { BADAJOZ_CENTER } from '../config.ts'
import { fromMadridLocal, MINUTES_PER_DAY } from '../time/madrid.ts'
import { STEP_MINUTES, sunPosition, type SunPosition } from './sunState.ts'

/**
 * The sun's path over one Madrid day, sampled every STEP_MINUTES of wall-clock
 * time: `positions[i]` is the sun at minute `i * STEP_MINUTES`.
 *
 * Computed once for the city centre and shared by every venue: across
 * Badajoz the sun's position differs by under 0.1°, far below the 1° horizon
 * bins.
 */
export type DayTrack = { date: string; positions: SunPosition[] }

const CENTRE = { lat: BADAJOZ_CENTER[1], lon: BADAJOZ_CENTER[0] }

export function dayTrack(date: string): DayTrack {
  const positions: SunPosition[] = []
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += STEP_MINUTES) {
    positions.push(sunPosition(fromMadridLocal(date, minute), CENTRE))
  }
  return { date, positions }
}

/** Index into `positions` for a minute of the day. */
export function stepIndex(minutes: number): number {
  const last = MINUTES_PER_DAY / STEP_MINUTES - 1
  return Math.min(last, Math.max(0, Math.floor(minutes / STEP_MINUTES)))
}

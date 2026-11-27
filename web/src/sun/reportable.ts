import type { Terrace } from '../data/terraces.ts'
import { toMadridLocal } from '../time/madrid.ts'
import type { SunCorrection } from './corrections.ts'
import { dayTrack, stepIndex } from './dayTrack.ts'
import { sunPosition } from './sunState.ts'
import { venueDay } from './venueStatus.ts'

/** The API refuses a sun report with the sun lower than this, in degrees. */
export const MIN_SUN_ALTITUDE = 2

/**
 * What a visitor can report for `venue` at `now`, the real present (not the
 * time bar's): the opposite of what the app says there now. It needs a
 * terrace with a horizon and the sun at least MIN_SUN_ALTITUDE up; then
 * 'sun' ("ahora mismo da el sol") where the app, with the corrections it
 * already has, says shade, and 'shade' ("ahora mismo hay sombra", ADR-0014)
 * where it says sun. Null otherwise.
 */
export function reportableSky(
  venue: Terrace,
  corrections: readonly SunCorrection[],
  now: Date,
): 'sun' | 'shade' | null {
  if (venue.terrace === null || venue.horizon === null) return null
  if (sunPosition(now, venue.terrace).altitude < MIN_SUN_ALTITUDE) return null
  const { date, minutes } = toMadridLocal(now)
  const own = corrections.filter((c) => c.venueId === venue.id)
  const state = venueDay(venue, dayTrack(date), own).timeline?.[
    stepIndex(minutes)
  ]
  return state === 'shade' ? 'sun' : state === 'sun' ? 'shade' : null
}

/** Whether a visitor can say "the sun is here" for `venue` at `now` (reportableSky). */
export function canReportSun(
  venue: Terrace,
  corrections: readonly SunCorrection[],
  now: Date,
): boolean {
  return reportableSky(venue, corrections, now) === 'sun'
}

import type { Terrace } from '../data/terraces.ts'
import { toMadridLocal } from '../time/madrid.ts'
import type { SunCorrection } from './corrections.ts'
import { dayTrack, stepIndex } from './dayTrack.ts'
import { sunPosition } from './sunState.ts'
import { venueDay } from './venueStatus.ts'

/** The API refuses a sun report with the sun lower than this, in degrees. */
export const MIN_SUN_ALTITUDE = 2

/**
 * Whether a visitor can say "the sun is here" for `venue` at `now`, the real
 * present (not the time bar's): it has a terrace with a horizon, the sun is
 * at least MIN_SUN_ALTITUDE up, and the app itself, with the corrections it
 * already has, says shade there now.
 */
export function canReportSun(
  venue: Terrace,
  corrections: readonly SunCorrection[],
  now: Date,
): boolean {
  if (venue.terrace === null || venue.horizon === null) return false
  if (sunPosition(now, venue.terrace).altitude < MIN_SUN_ALTITUDE) return false
  const { date, minutes } = toMadridLocal(now)
  const own = corrections.filter((c) => c.venueId === venue.id)
  const day = venueDay(venue, dayTrack(date), own)
  return day.timeline?.[stepIndex(minutes)] === 'shade'
}

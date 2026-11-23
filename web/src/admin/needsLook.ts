import type { Terrace } from '../data/terraces.ts'
import type { DayTrack } from '../sun/dayTrack.ts'
import { sunState } from '../sun/sunState.ts'

/**
 * Terraces whose horizon in terraces.json looks wrong, usually a pin against
 * a wall, under a tree crown or on a roof.
 */
export type LookReason = 'no_sun' | 'high_south'

export const LOOK_REASONS: Record<LookReason, string> = {
  no_sun: 'No sun today, 21 Jun or 21 Dec',
  high_south: 'South mostly above 60°',
}

/** 60°, in the horizon's tenths of a degree. */
export const HIGH_TENTHS = 600
/** Share of the southern half (azimuth 90° to 270°) that must be that high. */
export const HIGH_SHARE = 0.5

const SOUTH_FIRST = 90
const SOUTH_LAST = 269

/** Today and the two solstices of today's year, without repeats. */
export function referenceDates(today: string): string[] {
  const year = today.slice(0, 4)
  return [...new Set([today, `${year}-06-21`, `${year}-12-21`])]
}

export function lookReasons(
  horizon: readonly number[],
  tracks: readonly DayTrack[],
): LookReason[] {
  const reasons: LookReason[] = []
  const anySun = tracks.some((track) =>
    track.positions.some((p) => sunState(horizon, p) === 'sun'),
  )
  if (!anySun) reasons.push('no_sun')
  const south = horizon.slice(SOUTH_FIRST, SOUTH_LAST + 1)
  const high = south.filter((tenths) => tenths >= HIGH_TENTHS).length
  if (high > south.length * HIGH_SHARE) reasons.push('high_south')
  return reasons
}

export type LookItem = { venue: Terrace; reasons: LookReason[] }

/** Venues with a terrace and a horizon that trips at least one check, in input order. */
export function needsALook(
  venues: readonly Terrace[],
  tracks: readonly DayTrack[],
): LookItem[] {
  return venues.flatMap((venue) => {
    if (venue.terrace === null || venue.horizon === null) return []
    const reasons = lookReasons(venue.horizon, tracks)
    return reasons.length > 0 ? [{ venue, reasons }] : []
  })
}

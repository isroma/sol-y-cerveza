import { getPosition } from 'suncalc'
import type { LatLon } from '../data/terraces.ts'

export type SunState = 'sun' | 'shade' | 'night' | 'unknown'

/** Degrees. Azimuth is compass: 0 = north, 90 = east, clockwise. */
export type SunPosition = { altitude: number; azimuth: number }

export const STEP_MINUTES = 5
const STEP_MS = STEP_MINUTES * 60 * 1000

/**
 * Sun position at `location`. suncalc 2.x already returns degrees and a
 * compass azimuth in [0, 360); its altitude is refraction-corrected.
 */
export function sunPosition(instant: Date, location: LatLon): SunPosition {
  const { altitude, azimuth } = getPosition(instant, location.lat, location.lon)
  return { altitude, azimuth }
}

/** Horizon bin for a compass azimuth: bin i covers [i - 0.5°, i + 0.5°). */
export function horizonBin(azimuth: number): number {
  return ((Math.round(azimuth) % 360) + 360) % 360
}

/** The rule from docs/data-contract.md. `horizon` is in tenths of a degree. */
export function sunState(
  horizon: readonly number[] | null,
  position: SunPosition,
): SunState {
  if (position.altitude <= 0) return 'night'
  if (horizon === null) return 'unknown'
  const obstacle = horizon[horizonBin(position.azimuth)]
  if (obstacle === undefined) return 'unknown'
  return position.altitude * 10 > obstacle ? 'sun' : 'shade'
}

/**
 * Minutes of sun between `from` and `until`, sampled every STEP_MINUTES.
 * Pass the end of the day as `until`: samples after sunset are night and
 * count nothing. Null when the horizon is unknown.
 */
export function minutesOfSunLeft(
  horizon: readonly number[] | null,
  location: LatLon,
  from: Date,
  until: Date,
): number | null {
  if (horizon === null) return null
  let minutes = 0
  for (let t = from.getTime(); t < until.getTime(); t += STEP_MS) {
    const state = sunState(horizon, sunPosition(new Date(t), location))
    if (state === 'sun') minutes += STEP_MINUTES
  }
  return minutes
}

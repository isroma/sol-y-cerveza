import { getPosition } from 'suncalc'
import type { LatLon } from '../data/terraces.ts'

/** `partial`: some of the terrace in sun, some in shade (`envelopeState`). */
export type SunState = 'sun' | 'partial' | 'shade' | 'night' | 'unknown'

/** Lowest and highest obstacle per bin across a terrace, tenths of a degree. */
export type Envelope = { low: readonly number[]; high: readonly number[] }

/** Degrees. Azimuth is compass: 0 = north, 90 = east, clockwise. */
export type SunPosition = { altitude: number; azimuth: number }

export const STEP_MINUTES = 5

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
 * The envelope rule from docs/data-contract.md: sun when the sun clears the
 * highest obstacle over the terrace's points, shade when it clears none of
 * them, partial in between.
 */
export function envelopeState(
  envelope: Envelope,
  position: SunPosition,
): SunState {
  if (position.altitude <= 0) return 'night'
  const bin = horizonBin(position.azimuth)
  const low = envelope.low[bin]
  const high = envelope.high[bin]
  if (low === undefined || high === undefined) return 'unknown'
  const altitude = position.altitude * 10
  if (altitude > high) return 'sun'
  return altitude > low ? 'partial' : 'shade'
}

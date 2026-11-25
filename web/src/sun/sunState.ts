import { getPosition } from 'suncalc'
import type { LatLon } from '../data/terraces.ts'

export type SunState = 'sun' | 'shade' | 'night' | 'unknown'

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
 * Shade shorter than this between two sunny stretches counts as sun: mostly
 * noise in the surface model (a lamp post, the edge of a crown). With
 * 5-minute steps, gaps of up to 3 steps (15 minutes).
 */
export const SHORT_SHADE_UNDER_MINUTES = 20

/**
 * `timeline` with every shade gap under SHORT_SHADE_UNDER_MINUTES between two
 * sun steps turned into sun. Shade before the first sun and after the last
 * stays, and so does a gap with night in it.
 */
export function fillShortShade(timeline: readonly SunState[]): SunState[] {
  const maxSteps = Math.ceil(SHORT_SHADE_UNDER_MINUTES / STEP_MINUTES) - 1
  const filled = [...timeline]
  let lastSun: number | null = null
  timeline.forEach((state, i) => {
    if (state !== 'sun') return
    const gap = lastSun === null ? 0 : i - lastSun - 1
    if (
      lastSun !== null &&
      gap > 0 &&
      gap <= maxSteps &&
      timeline.slice(lastSun + 1, i).every((s) => s === 'shade')
    )
      filled.fill('sun', lastSun + 1, i)
    lastSun = i
  })
  return filled
}

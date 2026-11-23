import type { SunPosition } from '../sun/sunState.ts'

export type LonLat = [number, number]

/** Shadows longer than this are cut: low sun would paint the whole city. */
export const MAX_SHADOW_M = 250
const METRES_PER_DEGREE_LAT = 110_540
const METRES_PER_DEGREE_LON_AT_EQUATOR = 111_320

/**
 * Ground offset of a shadow cast by something `height` metres tall, in
 * degrees [dLon, dLat]. Shadows point away from the sun. Null when the sun is
 * down.
 */
export function shadowOffset(
  height: number,
  sun: SunPosition,
  latitude: number,
): LonLat | null {
  if (sun.altitude <= 0 || height <= 0) return null
  const length = Math.min(
    MAX_SHADOW_M,
    height / Math.tan((sun.altitude * Math.PI) / 180),
  )
  const away = ((sun.azimuth + 180) * Math.PI) / 180
  const east = length * Math.sin(away)
  const north = length * Math.cos(away)
  return [
    east /
      (METRES_PER_DEGREE_LON_AT_EQUATOR * Math.cos((latitude * Math.PI) / 180)),
    north / METRES_PER_DEGREE_LAT,
  ]
}

function cross(o: LonLat, a: LonLat, b: LonLat): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
}

/** Convex hull (Andrew's monotone chain), as a closed ring. */
export function convexHull(points: readonly LonLat[]): LonLat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const lower: LonLat[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: LonLat[] = []
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, p) <= 0)
      upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  const first = hull[0]
  return first ? [...hull, first] : hull
}

/**
 * Ground shadow of a building footprint: the hull of the footprint and the
 * footprint shifted by the shadow offset. Exact for convex footprints, a
 * little generous for concave ones.
 */
export function buildingShadow(
  footprint: readonly LonLat[],
  height: number,
  sun: SunPosition,
): LonLat[] | null {
  const first = footprint[0]
  if (!first) return null
  const offset = shadowOffset(height, sun, first[1])
  if (!offset) return null
  const moved = footprint.map(([lon, lat]): LonLat => [
    lon + offset[0],
    lat + offset[1],
  ])
  return convexHull([...footprint, ...moved])
}

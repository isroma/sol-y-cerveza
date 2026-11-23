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

/** Twice the signed area of a ring in a local metric frame: > 0 when counter-clockwise. */
function signedArea(ring: readonly LonLat[], k: number): number {
  let sum = 0
  for (let i = 0; i + 1 < ring.length; i++) {
    const a = ring[i]
    const b = ring[i + 1]
    if (a && b) sum += a[0] * k * b[1] - b[0] * k * a[1]
  }
  return sum
}

/**
 * Ground shadow of a building: one quad per wall that faces away from the sun,
 * swept from the wall's foot along the shadow (the roof covers the rest).
 * `rings` is a footprint polygon: the outer ring, then any courtyards (holes),
 * whose walls throw shadows into the courtyard. Exact for any shape, unlike a
 * hull of the footprint, which filled courtyards and inner corners.
 */
export function buildingShadow(
  rings: readonly (readonly LonLat[])[],
  height: number,
  sun: SunPosition,
): LonLat[][] | null {
  const first = rings[0]?.[0]
  if (!first) return null
  const offset = shadowOffset(height, sun, first[1])
  if (!offset) return null
  // Compare directions in metres: a degree of longitude is shorter here.
  const k = Math.cos((first[1] * Math.PI) / 180)
  const [ox, oy] = [offset[0] * k, offset[1]]
  const quads: LonLat[][] = []
  rings.forEach((ring, index) => {
    const ccw = signedArea(ring, k) > 0
    // Away from the solid: outside the outer ring, into a courtyard.
    const awayIsRight = index === 0 ? ccw : !ccw
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = ring[i]
      const b = ring[i + 1]
      if (!a || !b) continue
      const dx = (b[0] - a[0]) * k
      const dy = b[1] - a[1]
      const [nx, ny] = awayIsRight ? [dy, -dx] : [-dy, dx]
      // Walls along the shadow (or facing the sun) cast nothing; the
      // tolerance drops floating-point noise from walls exactly along it.
      const dot = nx * ox + ny * oy
      if (dot <= 1e-9 * Math.hypot(nx, ny) * Math.hypot(ox, oy)) continue
      const a2: LonLat = [a[0] + offset[0], a[1] + offset[1]]
      const b2: LonLat = [b[0] + offset[0], b[1] + offset[1]]
      quads.push([a, b, b2, a2, a])
    }
  })
  return quads
}

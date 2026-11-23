import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * The map tilts with the zoom: a flat top view when zoomed out to read the
 * city, easing into the tilted 3D view when zoomed in to see the shadows.
 */
export const FLAT_ZOOM = 14.5
export const TILTED_ZOOM = 16
export const TILTED_PITCH = 55
/** From here the view is tilted enough for 3D buildings and their shadows. */
export const RELIEF_ZOOM = 15.3

/**
 * Building shadows come in with the 3D buildings, once the view tilts: in the
 * flat and half-tilted views they only add grey noise.
 */
export const SHADOW_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  RELIEF_ZOOM,
  0,
  TILTED_ZOOM,
  0.6,
]

/**
 * 3D buildings rise quickly once the view tilts, so they never linger as
 * half-transparent ghosts in the flat or mid-zoom views.
 */
export const EXTRUSION_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  RELIEF_ZOOM,
  0,
  15.6, // RELIEF_ZOOM + 0.3, written out to avoid float noise
  1,
]

export function pitchForZoom(zoom: number): number {
  const t = Math.min(
    1,
    Math.max(0, (zoom - FLAT_ZOOM) / (TILTED_ZOOM - FLAT_ZOOM)),
  )
  const eased = t * t * (3 - 2 * t) // smoothstep: no jolt at either end
  return Math.round(eased * TILTED_PITCH * 10) / 10
}

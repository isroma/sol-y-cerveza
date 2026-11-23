import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * The map tilts with the zoom: a flat top view when zoomed out to read the
 * city, easing into the tilted 3D view when zoomed in to see the shadows.
 */
export const FLAT_ZOOM = 14.5
export const TILTED_ZOOM = 16
export const TILTED_PITCH = 55

/**
 * Building shadows fade with the tilt: barely there in the top view (they
 * clutter the city overview), clear once tilted in to read the streets.
 */
export const SHADOW_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  FLAT_ZOOM,
  0.1,
  TILTED_ZOOM,
  0.6,
]

/** 3D buildings appear as the view tilts, so the top view stays flat. */
export const EXTRUSION_OPACITY: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['zoom'],
  FLAT_ZOOM,
  0,
  FLAT_ZOOM + 0.8,
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

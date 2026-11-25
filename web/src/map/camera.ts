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

/**
 * The selected venue's card follows the zoom: it shrinks smoothly with the
 * pinch (cardScale) and folds back into its badge in the city overview
 * (cardFolded), with a short pop rather than a see-through fade.
 */
/** Below this the card folds into the selected badge. */
export const CARD_FOLD_BELOW = 15
/** The card's size just before it folds. */
export const CARD_MIN_SCALE = 0.6
const CARD_MAX_SCALE_ZOOM = 16.5

export function cardFolded(zoom: number): boolean {
  return zoom < CARD_FOLD_BELOW
}

export function cardScale(zoom: number): number {
  const t = Math.min(
    1,
    Math.max(
      0,
      (zoom - CARD_FOLD_BELOW) / (CARD_MAX_SCALE_ZOOM - CARD_FOLD_BELOW),
    ),
  )
  return Math.round((CARD_MIN_SCALE + t * (1 - CARD_MIN_SCALE)) * 1000) / 1000
}

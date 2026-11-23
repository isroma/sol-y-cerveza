import type { ExpressionSpecification } from 'maplibre-gl'

/**
 * The map tilts with the zoom: a flat top view when zoomed out to read the
 * city, easing into the tilted 3D view when zoomed in to see the shadows.
 */
export const FLAT_ZOOM = 14.5
export const TILTED_ZOOM = 16
export const TILTED_PITCH = 55
/**
 * Buildings are drawn this much taller than reality so the 3D city reads
 * well when tilted. Only the picture: sun and shade use real heights.
 */
export const BUILDING_HEIGHT_SCALE = 1.4
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

/**
 * How much of the selected venue's card shows at a zoom: the whole card up
 * close, only the name and the sun line in between, and none in the city
 * overview, where the venue is just its selected badge. Size and opacity
 * follow the zoom continuously (cardScale, cardOpacity), so a pinch shrinks
 * and fades the card smoothly; the level only swaps its content.
 */
export type CardLevel = 'full' | 'compact' | 'hidden'
/** Below this the card is gone and the selected badge stands in. */
export const CARD_GONE_BELOW = 14.5
/** Below this the card starts fading over the selected badge. */
export const CARD_FOLD_BELOW = 15
export const CARD_FULL_FROM = 15.75
/** Smallest size, reached as the card fades out. */
export const CARD_MIN_SCALE = 0.6
const CARD_MAX_SCALE_ZOOM = 16

export function cardLevel(zoom: number): CardLevel {
  if (zoom < CARD_GONE_BELOW) return 'hidden'
  return zoom < CARD_FULL_FROM ? 'compact' : 'full'
}

const clamp01 = (t: number) => Math.min(1, Math.max(0, t))

export function cardScale(zoom: number): number {
  const t = clamp01(
    (zoom - CARD_GONE_BELOW) / (CARD_MAX_SCALE_ZOOM - CARD_GONE_BELOW),
  )
  return Math.round((CARD_MIN_SCALE + t * (1 - CARD_MIN_SCALE)) * 1000) / 1000
}

export function cardOpacity(zoom: number): number {
  const t = clamp01(
    (zoom - CARD_GONE_BELOW) / (CARD_FOLD_BELOW - CARD_GONE_BELOW),
  )
  return Math.round(t * 1000) / 1000
}

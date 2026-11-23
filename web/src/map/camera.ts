/**
 * The map tilts with the zoom: a flat top view when zoomed out to read the
 * city, easing into the tilted 3D view when zoomed in to see the shadows.
 */
export const FLAT_ZOOM = 14.5
export const TILTED_ZOOM = 16
export const TILTED_PITCH = 55

export function pitchForZoom(zoom: number): number {
  const t = Math.min(
    1,
    Math.max(0, (zoom - FLAT_ZOOM) / (TILTED_ZOOM - FLAT_ZOOM)),
  )
  const eased = t * t * (3 - 2 * t) // smoothstep: no jolt at either end
  return Math.round(eased * TILTED_PITCH * 10) / 10
}

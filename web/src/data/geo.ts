/**
 * Geometry and name helpers shared by the app, the admin and the API Worker
 * (api/src imports this file). Keep it free of zod and the DOM, so the
 * Worker bundle stays small.
 */

export type LatLon = { lat: number; lon: number }

/**
 * The Badajoz area: the API accepts reports only inside it, the admin's sun
 * probe refuses anything outside, and the locate button flies only within it.
 * Mirrors BADAJOZ_BBOX in pipeline/src/solycerveza/geo.py.
 */
export const BADAJOZ_BBOX = {
  south: 38.84,
  west: -7.04,
  north: 38.92,
  east: -6.92,
} as const

/** Inside BADAJOZ_BBOX, edges included. */
export function insideBadajoz({ lat, lon }: LatLon): boolean {
  return (
    lat >= BADAJOZ_BBOX.south &&
    lat <= BADAJOZ_BBOX.north &&
    lon >= BADAJOZ_BBOX.west &&
    lon <= BADAJOZ_BBOX.east
  )
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/**
 * The north–south part of distanceMetres, which is never more than the whole
 * (less 1 m for rounding): a cheap test to skip far pairs before the full
 * distance.
 */
export function latitudeGapMetres(a: LatLon, b: LatLon): number {
  return Math.abs(b.lat - a.lat) * (Math.PI / 180) * 6_371_000 - 1
}

/**
 * A visitor's venue name as the API stores it: commas, quotes and line breaks
 * become spaces, whitespace is collapsed.
 */
export function cleanVenueName(raw: string): string {
  return raw
    .replace(/[,"'“”‘’«»\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A venue id in terraces.json: its source prefix, then the source's own id.
 * Mirrors VENUE_ID_PATTERN in pipeline/src/solycerveza/venues.py.
 */
export const VENUE_ID =
  /^(osm:(node|way)\/\d+|overture:[0-9A-Za-z-]+|junta:[0-9a-f]{12}|review:[a-z0-9]+(-[a-z0-9]+)*)$/

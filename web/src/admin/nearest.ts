import type { LatLon } from '../data/terraces.ts'

const EARTH_RADIUS_M = 6_371_000

/** Metres between two points; equirectangular, plenty for a city. */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * EARTH_RADIUS_M
}

/** Items nearest first (ties keep their order), with their distance. */
export function byDistance<T>(
  items: readonly T[],
  from: LatLon,
  at: (item: T) => LatLon,
): { item: T; metres: number }[] {
  return items
    .map((item) => ({ item, metres: distanceM(from, at(item)) }))
    .sort((a, b) => a.metres - b.metres)
}

/** "8 m", "120 m", "1,4 km". */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)} m`
  return `${(metres / 1000).toFixed(1).replace('.', ',')} km`
}

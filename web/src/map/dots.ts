import type { VenueStatus } from '../sun/venueStatus.ts'

/** The grey dots: venues without a terrace, with the selected one marked. */
export function dotsData(
  statuses: readonly VenueStatus[],
  selectedId: string | null,
) {
  return {
    type: 'FeatureCollection' as const,
    features: statuses
      .filter((s) => !s.hasTerrace)
      .map((s) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [s.venue.venue.lon, s.venue.venue.lat],
        },
        properties: {
          id: s.venue.id,
          selected: s.venue.id === selectedId,
          name: s.venue.name,
        },
      })),
  }
}

export type DotsData = ReturnType<typeof dotsData>

/**
 * The dots to send to the map, or null when they are the same as the last
 * ones sent (`previousKey`). The dots don't depend on the time of day, so
 * moving the time slider sends nothing; MapLibre would otherwise re-tile the
 * whole source on every step.
 */
export function dotsUpdate(
  previousKey: string | null,
  statuses: readonly VenueStatus[],
  selectedId: string | null,
): { key: string; data: DotsData } | null {
  const data = dotsData(statuses, selectedId)
  const key = JSON.stringify(data)
  return key === previousKey ? null : { key, data }
}

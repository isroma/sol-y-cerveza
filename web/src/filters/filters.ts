import { demoValues } from '../demo/demo.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'

export type Filters = {
  /** Only venues in sun at the chosen time. */
  sunNow: boolean
  /** Demo price cap in cents, or null for any. */
  maxPriceCents: number | null
  /** Demo minimum rating, or null for any. */
  minRating: number | null
  /** Hide venues without a known terrace. */
  onlyTerrace: boolean
}

export const DEFAULT_FILTERS: Filters = {
  sunNow: false,
  maxPriceCents: null,
  minRating: null,
  onlyTerrace: false,
}

/** Lower case without accents, so "cafe" finds "Café". */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .trim()
}

export function matchesQuery(name: string, query: string): boolean {
  const q = normalize(query)
  return q === '' || normalize(name).includes(q)
}

export function applyFilters(
  statuses: readonly VenueStatus[],
  filters: Filters,
  query: string,
): VenueStatus[] {
  return statuses.filter((status) => {
    const demo = demoValues(status.venue.id)
    return (
      matchesQuery(status.venue.name, query) &&
      (!filters.sunNow || status.category === 'sun') &&
      (!filters.onlyTerrace || status.hasTerrace) &&
      (filters.maxPriceCents === null ||
        demo.priceCents <= filters.maxPriceCents) &&
      (filters.minRating === null || demo.rating >= filters.minRating)
    )
  })
}

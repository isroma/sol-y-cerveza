import type { VenueStatus } from '../sun/venueStatus.ts'

export type Filters = {
  /** Only venues in sun at the chosen time. */
  sunNow: boolean
  /** Hide venues without a known terrace. */
  onlyTerrace: boolean
}

export const DEFAULT_FILTERS: Filters = {
  sunNow: false,
  // Off, so the list shows every bar and restaurant, not only those with a
  // known terrace (owner, 2026-11-26).
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
  return statuses.filter(
    (status) =>
      matchesQuery(status.venue.name, query) &&
      (!filters.sunNow || status.category === 'sun') &&
      (!filters.onlyTerrace || status.hasTerrace),
  )
}

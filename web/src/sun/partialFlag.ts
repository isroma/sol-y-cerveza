/**
 * "Sol parcial" is a prototype (#409): only links with `?partial=1` judge a
 * terrace by its envelope and can show it partly in sun.
 */
export function partialSunEnabled(search: string): boolean {
  return new URLSearchParams(search).get('partial') === '1'
}

/** Read once per page load; the parameter survives the app's URL updates. */
export const PARTIAL_SUN = partialSunEnabled(
  typeof window === 'undefined' ? '' : window.location.search,
)

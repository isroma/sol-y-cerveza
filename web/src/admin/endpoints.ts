/**
 * The dev server's admin endpoints, named once for the admin page and for
 * web/plugins/admin/reviewServer.ts, which serves them. Dev only: never part of the built
 * site.
 */
export const ADMIN_ENDPOINTS = {
  /** venue_review.csv: GET, PUT a row, DELETE ?venue_id= */
  review: '/__admin/review',
  /** Publish (web/plugins/admin/publish.ts): GET the status, POST to start one. */
  publish: '/__admin/publish',
  /** venue_prices.csv: GET, PUT a row, DELETE ?key= */
  prices: '/__admin/prices',
  /** Website price candidates: GET, POST a decision (ADR-0006). */
  priceCandidates: '/__admin/price-candidates',
  /** Machine proposals: GET, POST one to ignore (ADR-0008). */
  proposals: '/__admin/proposals',
  /** Visitor price suggestions, proxied to the API. */
  suggestions: '/__admin/suggestions',
  /** Visitor venue reports, proxied to the API (ADR-0009). */
  reports: '/__admin/reports',
  /** Visitor sun reports, proxied to the API (issue #364). */
  sun: '/__admin/sun',
  /** Accepted sun reports, proxied to the API's GET /v1/admin/sun/accepted (issue #463). */
  sunAccepted: '/__admin/sun-accepted',
  /** sun_corrections.csv: GET, POST rows to add the ones it lacks (issue #463). */
  sunCorrections: '/__admin/sun-corrections',
  /** Trust tiers of Overture venues: GET (`python -m solycerveza.trust`, issue #493). */
  trust: '/__admin/trust',
  /** Sun preview at a pin: GET ?lat=&lon= (`python -m solycerveza.probe`). */
  probe: '/__admin/probe',
} as const

/** The prefix all of them share, which adminGuard.ts guards as a whole. */
export const ADMIN_PREFIX = '/__admin'

import { STEP_MINUTES } from '../sun/sunState.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'

/** Below this zoom only the best places keep a full pin; the rest shrink. */
export const OVERVIEW_ZOOM = 15
export const HIGHLIGHT_COUNT = 8

/** Minutes of direct sun on the terrace over the whole day. */
export function sunMinutesToday(status: VenueStatus): number {
  if (!status.timeline) return 0
  return (
    status.timeline.filter((state) => state === 'sun').length * STEP_MINUTES
  )
}

/**
 * The places that stand out when zoomed out: terraces in sun right now, the
 * sunniest over the day first. Beer price joins the score once real prices
 * exist (#8).
 */
export function highlightedIds(
  statuses: readonly VenueStatus[],
  count = HIGHLIGHT_COUNT,
): Set<string> {
  return new Set(
    statuses
      .filter((status) => status.hasTerrace && status.category === 'sun')
      .map((status) => ({ id: status.venue.id, sun: sunMinutesToday(status) }))
      .sort((a, b) => b.sun - a.sun || a.id.localeCompare(b.id))
      .slice(0, count)
      .map(({ id }) => id),
  )
}

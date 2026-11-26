import { formatCents } from '../data/prices.ts'
import type { ShownPrice } from '../prices/crowd.ts'
import { STEP_MINUTES } from '../sun/sunState.ts'
import type { SunState } from '../sun/sunState.ts'
import { stepIndex } from '../sun/dayTrack.ts'

/**
 * Prices on the map's badges (#265): the caña, on the badges that are the
 * best value in their part of the screen, so a busy street doesn't turn into
 * a wall of prices.
 */

export type BadgePrice = { cents: number; approximate: boolean }

/** The caña the card shows, or null: the badge only ever shows a caña. */
export function canaPrice(prices: readonly ShownPrice[]): BadgePrice | null {
  const cana = prices.find((p) => p.item === 'cana')
  return cana ? { cents: cana.cents, approximate: cana.approximate } : null
}

export function badgePriceText(price: BadgePrice): string {
  return `${price.approximate ? '~' : ''}${formatCents(price.cents)}`
}

/** Minutes of direct sun on the terrace from `minutes` to the end of the day. */
export function sunLeft(
  timeline: readonly SunState[] | null,
  minutes: number,
): number {
  if (!timeline) return 0
  return (
    timeline.slice(stepIndex(minutes)).filter((s) => s === 'sun').length *
    STEP_MINUTES
  )
}

/**
 * Value for money: sun still to come per euro. The half hour added keeps
 * shaded terraces ranked by price instead of all tying at zero.
 */
export function priceScore(sunMinutesLeft: number, cents: number): number {
  return (sunMinutesLeft + 30) / cents
}

/**
 * A badge that could show its price: `x`, `y` the pointer's tip on screen;
 * `tab` how far its price tab reaches right of `x` at full size, and `scale`
 * the badge's size (grey badges are drawn at 78 %), both in px.
 */
export type BadgeCandidate = {
  id: string
  x: number
  y: number
  score: number
  tab: number
  scale: number
}

/** The badge's half width and its height from the pointer's tip, in px. */
const BADGE = { half: 19, height: 48 }
/** Room kept between two priced badges, in px. */
const GAP = 2

/** What a priced badge covers on screen: the badge, and its tab to the right. */
function box(c: BadgeCandidate) {
  return {
    left: c.x - BADGE.half * c.scale,
    right: c.x + Math.max(BADGE.half, c.tab) * c.scale,
    top: c.y - BADGE.height * c.scale,
    bottom: c.y,
  }
}

/**
 * The badges that show their price: best score first, each kept only if its
 * badge and tab would not overlap one already kept. The tab only reaches
 * right, so a badge with free space to its right can show its price close to
 * a neighbour on its left. Ties go to the id, so the choice doesn't flicker
 * between renders.
 */
export function pricedBadges(
  candidates: readonly BadgeCandidate[],
): Set<string> {
  const kept: ReturnType<typeof box>[] = []
  const ids: string[] = []
  const order = [...candidates].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  )
  for (const c of order) {
    const b = box(c)
    const clashes = kept.some(
      (k) =>
        b.left < k.right + GAP &&
        k.left < b.right + GAP &&
        b.top < k.bottom + GAP &&
        k.top < b.bottom + GAP,
    )
    if (!clashes) {
      kept.push(b)
      ids.push(c.id)
    }
  }
  return new Set(ids)
}

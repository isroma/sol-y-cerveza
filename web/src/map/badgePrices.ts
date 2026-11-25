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

export type BadgeCandidate = { id: string; x: number; y: number; score: number }

/** A badge with a price is about this wide and tall on screen, in px. */
export const PRICE_BADGE = { width: 96, height: 44 }

/**
 * The badges that show their price: best score first, each kept only if no
 * badge already kept would overlap it on screen. Ties go to the id, so the
 * choice doesn't flicker between renders.
 */
export function pricedBadges(
  candidates: readonly BadgeCandidate[],
  size = PRICE_BADGE,
): Set<string> {
  const kept: BadgeCandidate[] = []
  const order = [...candidates].sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id),
  )
  for (const c of order) {
    const clashes = kept.some(
      (k) =>
        Math.abs(k.x - c.x) < size.width && Math.abs(k.y - c.y) < size.height,
    )
    if (!clashes) kept.push(c)
  }
  return new Set(kept.map((k) => k.id))
}

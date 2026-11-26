import { describe, expect, it } from 'vitest'
import type { SunState } from '../sun/sunState.ts'
import {
  badgePriceText,
  canaPrice,
  pricedBadges,
  priceScore,
  sunLeft,
} from './badgePrices.ts'

describe('canaPrice', () => {
  it('takes the caña only', () => {
    expect(
      canaPrice([
        {
          item: 'cana',
          brand: null,
          cents: 140,
          approximate: false,
          updated: '2026-11-25',
        },
        {
          item: 'tercio',
          brand: 'cruzcampo',
          cents: 200,
          approximate: false,
          updated: '2026-11-25',
        },
      ]),
    ).toEqual({ cents: 140, approximate: false })
    expect(
      canaPrice([
        {
          item: 'tercio',
          brand: 'cruzcampo',
          cents: 200,
          approximate: false,
          updated: '2026-11-25',
        },
      ]),
    ).toBeNull()
  })

  it('marks a visitors’ estimate with ~', () => {
    expect(badgePriceText({ cents: 150, approximate: true })).toBe('~1,50 €')
    expect(badgePriceText({ cents: 140, approximate: false })).toBe('1,40 €')
  })
})

describe('sunLeft', () => {
  it('counts the sun from the chosen time to the end of the day', () => {
    // 288 steps of 5 min: sun from 12:00 to 14:00.
    const timeline: SunState[] = Array.from({ length: 288 }, (_, i) =>
      i >= 144 && i < 168 ? 'sun' : 'shade',
    )
    expect(sunLeft(timeline, 11 * 60)).toBe(120)
    expect(sunLeft(timeline, 13 * 60)).toBe(60)
    expect(sunLeft(timeline, 15 * 60)).toBe(0)
    expect(sunLeft(null, 600)).toBe(0)
  })
})

describe('pricedBadges', () => {
  // A full-size badge with "1,40 €": its tab reaches 87 px right of its tip.
  const badge = (id: string, x: number, y: number, score: number) => ({
    id,
    x,
    y,
    score,
    tab: 87,
    scale: 1,
  })

  it('keeps the best value where badges would overlap, and all apart', () => {
    const cheapSunny = badge('a', 100, 100, priceScore(120, 140))
    const dearSunny = badge('b', 150, 110, priceScore(120, 220))
    const farAway = badge('c', 400, 100, priceScore(0, 300))
    expect(pricedBadges([dearSunny, cheapSunny, farAway])).toEqual(
      new Set(['a', 'c']),
    )
  })

  it('prefers more sun for the money over a lower price alone', () => {
    const shadedCheap = badge('a', 0, 0, priceScore(0, 120))
    const sunnyFair = badge('b', 10, 0, priceScore(180, 160))
    expect(pricedBadges([shadedCheap, sunnyFair])).toEqual(new Set(['b']))
  })

  it('lets a badge right of a priced one show its price once clear of the tab', () => {
    const best = badge('a', 100, 100, priceScore(120, 140))
    // The tab ends at 187; this badge starts 19 px left of its tip.
    const touching = badge('b', 205, 100, priceScore(120, 320))
    const clear = badge('c', 215, 100, priceScore(120, 320))
    expect(pricedBadges([best, touching])).toEqual(new Set(['a']))
    expect(pricedBadges([best, clear])).toEqual(new Set(['a', 'c']))
  })

  it('needs the whole tab clear for a badge on the left', () => {
    const best = badge('a', 200, 100, priceScore(120, 140))
    // Its tab would reach 87 px right, into the best badge at 181.
    const left = badge('b', 100, 100, priceScore(120, 320))
    expect(pricedBadges([best, left])).toEqual(new Set(['a']))
  })

  it('counts grey badges at their smaller size', () => {
    const best = badge('a', 100, 100, priceScore(120, 140))
    // At 207 a full-size badge would start at 188, inside the 2 px gap; a
    // grey one (78 %) starts at 192.
    const full = badge('b', 207, 100, priceScore(0, 320))
    const grey = { ...full, scale: 0.78 }
    expect(pricedBadges([best, full])).toEqual(new Set(['a']))
    expect(pricedBadges([best, grey])).toEqual(new Set(['a', 'b']))
  })
})

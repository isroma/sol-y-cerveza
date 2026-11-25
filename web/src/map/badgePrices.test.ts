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
        { item: 'cana', brand: null, cents: 140, approximate: false },
        { item: 'tercio', brand: 'cruzcampo', cents: 200, approximate: false },
      ]),
    ).toEqual({ cents: 140, approximate: false })
    expect(
      canaPrice([
        { item: 'tercio', brand: 'cruzcampo', cents: 200, approximate: false },
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
  it('keeps the best value where badges would overlap, and all apart', () => {
    const cheapSunny = { id: 'a', x: 100, y: 100, score: priceScore(120, 140) }
    const dearSunny = { id: 'b', x: 150, y: 110, score: priceScore(120, 220) }
    const farAway = { id: 'c', x: 400, y: 100, score: priceScore(0, 300) }
    expect(pricedBadges([dearSunny, cheapSunny, farAway])).toEqual(
      new Set(['a', 'c']),
    )
  })

  it('prefers more sun for the money over a lower price alone', () => {
    const shadedCheap = { id: 'a', x: 0, y: 0, score: priceScore(0, 120) }
    const sunnyFair = { id: 'b', x: 10, y: 0, score: priceScore(180, 160) }
    expect(pricedBadges([shadedCheap, sunnyFair])).toEqual(new Set(['b']))
  })
})

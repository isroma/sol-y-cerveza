import { describe, expect, it } from 'vitest'
import { demoValues, formatPrice, formatRating } from './demo.ts'

describe('demoValues', () => {
  it('is stable for an id', () => {
    expect(demoValues('osm:node/1')).toEqual(demoValues('osm:node/1'))
  })

  it('stays within plausible ranges', () => {
    for (let i = 0; i < 500; i++) {
      const { priceCents, rating, reviews } = demoValues(`osm:node/${i}`)
      expect(priceCents).toBeGreaterThanOrEqual(200)
      expect(priceCents).toBeLessThanOrEqual(340)
      expect(priceCents % 10).toBe(0)
      expect(rating).toBeGreaterThanOrEqual(3.6)
      expect(rating).toBeLessThanOrEqual(4.8)
      expect(reviews).toBeGreaterThanOrEqual(12)
    }
  })

  it('varies between venues', () => {
    const prices = new Set(
      Array.from({ length: 50 }, (_, i) => demoValues(`v${i}`).priceCents),
    )
    expect(prices.size).toBeGreaterThan(5)
  })
})

describe('formatting', () => {
  it('uses Spanish conventions', () => {
    expect(formatPrice(250).replace(/\s/g, ' ')).toBe('2,50 €')
    expect(formatRating(4.3)).toBe('4,3')
  })
})

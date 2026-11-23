import { describe, expect, it } from 'vitest'
import { byDistance, distanceM, formatDistance } from './nearest.ts'

const plaza = { lat: 38.8786, lon: -6.9703 }

describe('distanceM', () => {
  it('measures about 111 m per millidegree of latitude', () => {
    expect(distanceM(plaza, { lat: 38.8796, lon: -6.9703 })).toBeCloseTo(111, 0)
  })

  it('shrinks longitude by the cosine of the latitude', () => {
    const d = distanceM(plaza, { lat: 38.8786, lon: -6.9693 })
    expect(d).toBeGreaterThan(85)
    expect(d).toBeLessThan(88)
  })
})

describe('byDistance', () => {
  it('sorts nearest first with the distance', () => {
    const venues = [
      { id: 'far', at: { lat: 38.89, lon: -6.97 } },
      { id: 'near', at: { lat: 38.8787, lon: -6.9703 } },
      { id: 'mid', at: { lat: 38.88, lon: -6.9703 } },
    ]
    const sorted = byDistance(venues, plaza, (v) => v.at)
    expect(sorted.map((s) => s.item.id)).toEqual(['near', 'mid', 'far'])
    expect(sorted[0]?.metres).toBeCloseTo(11, 0)
  })
})

describe('formatDistance', () => {
  it('uses metres, then kilometres with a decimal comma', () => {
    expect(formatDistance(7.6)).toBe('8 m')
    expect(formatDistance(999)).toBe('999 m')
    expect(formatDistance(1420)).toBe('1,4 km')
  })
})

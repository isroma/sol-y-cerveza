import { describe, expect, it } from 'vitest'
import {
  circle,
  TEXTURE_HEIGHT,
  TEXTURE_WIDTH,
  treeFeatures,
  umbrellaFeatures,
  wallTexture,
} from './cityDetail.ts'

describe('wallTexture', () => {
  it('is an opaque RGBA tile of the declared size', () => {
    const tile = wallTexture(0, false)
    expect(tile.data.length).toBe(TEXTURE_WIDTH * TEXTURE_HEIGHT * 4)
    expect(
      tile.data.filter((_, i) => i % 4 === 3).every((a) => a === 255),
    ).toBe(true)
  })

  it('lights some windows at night', () => {
    const lit = (tint: number) => {
      const { data } = wallTexture(tint, true)
      let count = 0
      for (let i = 0; i < data.length; i += 4)
        if (data[i] === 0xff && data[i + 1] === 0xd5) count++
      return count
    }
    expect(lit(0)).toBeGreaterThan(0)
    expect(lit(1)).toBeGreaterThan(0)
  })
})

describe('geometry', () => {
  it('closes circles of the right size', () => {
    const ring = circle(-6.97, 38.88, 10).coordinates[0] ?? []
    expect(ring[0]).toEqual(ring[ring.length - 1])
    const [x = 0, y = 0] = ring[0] ?? []
    const dx = (x + 6.97) * 111_195 * Math.cos((38.88 * Math.PI) / 180)
    expect(Math.round(dx * 10) / 10).toBe(10)
    expect(y).toBeCloseTo(38.88, 6)
  })

  it('draws five umbrellas (pole and canopy) per terrace', () => {
    const umbrellas = umbrellaFeatures([{ lon: -6.97, lat: 38.88 }])
    expect(umbrellas.features).toHaveLength(10)
  })

  it('draws a trunk and two crown tiers per tree', () => {
    const [trunk, crown, top] = treeFeatures([[-6.97, 38.88, 10, 3]]).features
    expect(trunk?.properties.top).toBeCloseTo(crown?.properties.base ?? 0)
    expect(top?.properties.top).toBeCloseTo(14)
  })
})

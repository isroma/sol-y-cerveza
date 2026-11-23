import { describe, expect, it } from 'vitest'
import {
  buildingShadow,
  convexHull,
  MAX_SHADOW_M,
  shadowOffset,
  type LonLat,
} from './shadows.ts'

const LAT = 38.88
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((LAT * Math.PI) / 180)

describe('shadowOffset', () => {
  it('points north, as long as the height, with the sun due south at 45°', () => {
    const offset = shadowOffset(10, { altitude: 45, azimuth: 180 }, LAT)
    expect(offset?.[0]).toBeCloseTo(0, 9)
    expect((offset?.[1] ?? 0) * M_LAT).toBeCloseTo(10, 6)
  })

  it('points west in the morning sun and east in the evening', () => {
    expect(
      shadowOffset(10, { altitude: 30, azimuth: 90 }, LAT)?.[0],
    ).toBeLessThan(0)
    expect(
      shadowOffset(10, { altitude: 30, azimuth: 270 }, LAT)?.[0],
    ).toBeGreaterThan(0)
  })

  it('is longer with a lower sun, capped, and absent at night', () => {
    const east = (alt: number) =>
      (shadowOffset(10, { altitude: alt, azimuth: 270 }, LAT)?.[0] ?? 0) * M_LON
    expect(east(30)).toBeCloseTo(10 / Math.tan(Math.PI / 6), 6)
    expect(east(0.5)).toBeCloseTo(MAX_SHADOW_M, 6)
    expect(shadowOffset(10, { altitude: -2, azimuth: 270 }, LAT)).toBeNull()
  })
})

describe('convexHull', () => {
  it('drops inner points and closes the ring', () => {
    const square: LonLat[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0.5, 0.5],
    ]
    const hull = convexHull(square)
    expect(hull).toHaveLength(5)
    expect(hull[0]).toEqual(hull.at(-1))
    expect(hull).not.toContainEqual([0.5, 0.5])
  })
})

describe('buildingShadow', () => {
  it('covers the footprint and its shifted copy', () => {
    const d = 10 / M_LAT
    const footprint: LonLat[] = [
      [0, LAT],
      [d, LAT],
      [d, LAT + d],
      [0, LAT + d],
    ]
    const shadow = buildingShadow(footprint, 10, { altitude: 45, azimuth: 180 })
    const maxLat = Math.max(...(shadow ?? []).map(([, lat]) => lat))
    expect((maxLat - LAT) * M_LAT).toBeCloseTo(20, 4)
  })

  it('is null when the sun is down', () => {
    expect(
      buildingShadow([[0, LAT]], 10, { altitude: -1, azimuth: 0 }),
    ).toBeNull()
  })
})

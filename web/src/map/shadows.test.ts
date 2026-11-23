import { describe, expect, it } from 'vitest'
import {
  buildingShadow,
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

const D = 10 / M_LAT // 10 m in latitude degrees
const DX = 10 / M_LON // 10 m in longitude degrees
const NOON = { altitude: 45, azimuth: 180 } // shadows 1:1, due north

/** A square footprint `size` metres wide at (east, north) metres, counter-clockwise. */
function square(east: number, north: number, size: number): LonLat[] {
  const x = (east / 10) * DX
  const y = LAT + (north / 10) * D
  const w = (size / 10) * DX
  const h = (size / 10) * D
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ]
}

const northMetres = (quads: LonLat[][]) =>
  Math.max(...quads.flat().map(([, lat]) => (lat - LAT) * M_LAT))

describe('buildingShadow', () => {
  it('sweeps the walls facing away from the sun', () => {
    const quads = buildingShadow([square(0, 0, 10)], 10, NOON) ?? []
    // Noon sun: only the north wall casts, 10 m long for a 10 m building.
    expect(quads).toHaveLength(1)
    expect(northMetres(quads)).toBeCloseTo(20, 4)
  })

  it('handles either ring direction', () => {
    const cw = square(0, 0, 10).slice().reverse()
    expect(buildingShadow([cw], 10, NOON)).toHaveLength(1)
  })

  it('casts a courtyard wall shadow into the courtyard, not over it all', () => {
    // A 30 m block with a 10 m courtyard in the middle (a ring of walls).
    const outer = square(0, 0, 30)
    const courtyard = square(10, 10, 10).slice().reverse()
    const quads = buildingShadow([outer, courtyard], 10, NOON) ?? []
    // The outer north wall, and the courtyard's south wall facing north.
    expect(quads).toHaveLength(2)
    const inside = quads.find((q) =>
      q.every(([, lat]) => (lat - LAT) * M_LAT <= 20 + 1e-6),
    )
    expect(inside).toBeDefined()
    // That shadow starts at the courtyard's south wall (10 m) and ends 10 m on.
    const lats = (inside ?? []).map(([, lat]) => (lat - LAT) * M_LAT)
    expect(Math.min(...lats)).toBeCloseTo(10, 4)
    expect(Math.max(...lats)).toBeCloseTo(20, 4)
  })

  it('does not fill the inside corner of an L-shaped building', () => {
    // L: 20 m square minus its north-east 10 m quarter.
    const ring: LonLat[] = [
      [0, LAT],
      [2 * DX, LAT],
      [2 * DX, LAT + D],
      [DX, LAT + D],
      [DX, LAT + 2 * D],
      [0, LAT + 2 * D],
      [0, LAT],
    ]
    const quads = buildingShadow([ring], 5, NOON) ?? []
    // North-facing walls: the short one at 10 m and the long one at 20 m.
    expect(quads).toHaveLength(2)
    const corner = quads.find((q) => q.some(([lon]) => lon > DX * 1.5))
    const lats = (corner ?? []).map(([, lat]) => (lat - LAT) * M_LAT)
    expect(Math.min(...lats)).toBeCloseTo(10, 4)
    expect(Math.max(...lats)).toBeCloseTo(15, 4)
  })

  it('is null when the sun is down', () => {
    expect(
      buildingShadow([square(0, 0, 10)], 10, { altitude: -1, azimuth: 0 }),
    ).toBeNull()
  })
})

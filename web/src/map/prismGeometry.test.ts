import type { FeatureCollection, Polygon } from 'geojson'
import { describe, expect, it } from 'vitest'
import type { ExtrusionProperties } from './extrusionCodec.ts'
import {
  CAP_FLOATS,
  CELL_FLOATS,
  CELL_M,
  EDGE_FLOATS,
  mercatorX,
  prismArrays,
  prismFrame,
} from './prismGeometry.ts'

const frame = prismFrame(-6.97, 38.88)

/** A square `size` metres wide with its south-west corner `x`, `y` metres east and north of the origin. */
function square(
  x: number,
  y: number,
  size: number,
  b: number,
  h: number,
): FeatureCollection<Polygon, ExtrusionProperties>['features'][number] {
  const lon = (m: number) => -6.97 + (m / frame.metresPerUnit) * 360
  // y is south in the frame: north is a smaller mercator y.
  const lat = (m: number) => {
    const y = frame.origin[1] - m / frame.metresPerUnit
    return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
  }
  const ring = [
    [lon(x), lat(y)],
    [lon(x + size), lat(y)],
    [lon(x + size), lat(y + size)],
    [lon(x), lat(y + size)],
    [lon(x), lat(y)],
  ]
  return {
    type: 'Feature',
    properties: { b, h },
    geometry: { type: 'Polygon', coordinates: [ring] },
  }
}

const collection = (
  ...features: ReturnType<typeof square>[]
): FeatureCollection<Polygon, ExtrusionProperties> => ({
  type: 'FeatureCollection',
  features,
})

describe('prismArrays', () => {
  it('puts the origin at 0, 0 in local metres', () => {
    expect(mercatorX(-6.97) - frame.origin[0]).toBe(0)
    expect(frame.metresPerUnit).toBeCloseTo(
      40075016.686 * Math.cos((38.88 * Math.PI) / 180),
    )
  })

  it('emits one edge per side of a building and no cap, as it stands on the ground', () => {
    const arrays = prismArrays([collection(square(0, 0, 10, 0, 12))], frame)
    expect(arrays.edges.length).toBe(4 * EDGE_FLOATS)
    expect(arrays.caps.length).toBe(0)
    expect(arrays.capIndices.length).toBe(0)
    const first = Array.from(arrays.edges.slice(0, EDGE_FLOATS))
    expect(first[0]).toBeCloseTo(0, 1)
    expect(first[1]).toBeCloseTo(0, 1)
    // East along the south side, y south: still 0.
    expect(first[2]).toBeCloseTo(10, 1)
    expect(first[3]).toBeCloseTo(0, 1)
    expect(first.slice(4)).toEqual([0, 12])
  })

  it('caps a floating crown at its base, triangulated', () => {
    const arrays = prismArrays([collection(square(0, 0, 6, 3, 9))], frame)
    expect(arrays.caps.length).toBe(4 * CAP_FLOATS)
    expect(arrays.caps[2]).toBe(3)
    expect(arrays.capIndices.length).toBe(2 * 3)
  })

  it('groups prisms by cell, each with its bounds and runs', () => {
    const arrays = prismArrays(
      [
        collection(square(0, 0, 10, 0, 12), square(CELL_M * 3, 0, 10, 0, 6)),
        collection(square(5, 5, 4, 2, 8)),
      ],
      frame,
    )
    expect(arrays.cells.length).toBe(2 * CELL_FLOATS)
    const [minX, , maxX, , edgeStart, edgeCount, indexStart, indexCount] =
      Array.from(arrays.cells.slice(0, CELL_FLOATS))
    expect(minX).toBeCloseTo(0, 1)
    expect(maxX).toBeCloseTo(10, 1)
    expect([edgeStart, edgeCount, indexStart, indexCount]).toEqual([0, 8, 0, 6])
    expect(Array.from(arrays.cells.slice(CELL_FLOATS + 4))).toEqual([
      8, 4, 6, 0,
    ])
  })

  it('skips prisms with no height', () => {
    const arrays = prismArrays([collection(square(0, 0, 10, 4, 4))], frame)
    expect(arrays.edges.length).toBe(0)
    expect(arrays.cells.length).toBe(0)
  })
})

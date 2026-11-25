import { describe, expect, it } from 'vitest'
import { CELL_FLOATS, prismFrame } from './prismGeometry.ts'
import {
  frameMatrix,
  MAX_SHADOW_M,
  shadowOpacity,
  shadowStep,
  visibleRuns,
} from './prismShadows.ts'

describe('shadowStep', () => {
  it('points away from the sun, 1 / tan(altitude) per metre of height', () => {
    // Sun due south at 45°: shadows fall north (y is south), 1 m per metre.
    const [x, y] = shadowStep({ altitude: 45, azimuth: 180 })
    expect(x).toBeCloseTo(0)
    expect(y).toBeCloseTo(-1)
    // Sun in the west, low: long shadows to the east.
    const [ex, ey] = shadowStep({ altitude: 10, azimuth: 270 })
    expect(ex).toBeCloseTo(1 / Math.tan((10 * Math.PI) / 180))
    expect(ey).toBeCloseTo(0)
  })
})

describe('shadowOpacity', () => {
  it('follows the tilt', () => {
    expect(shadowOpacity(14)).toBe(0)
    expect(shadowOpacity(18)).toBe(0.6)
  })
})

describe('frameMatrix', () => {
  it('maps frame metres to the mercator point the map matrix expects', () => {
    const frame = prismFrame(-6.97, 38.88)
    // A map matrix that is the identity: the result is mercator itself.
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const m = frameMatrix(identity, frame)
    const at = (x: number, y: number) => [
      (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[12] ?? 0),
      (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[13] ?? 0),
    ]
    const [x0, y0] = at(0, 0)
    expect(x0).toBeCloseTo(frame.origin[0], 6)
    expect(y0).toBeCloseTo(frame.origin[1], 6)
    const [x1] = at(frame.metresPerUnit * 1e-6, 0)
    expect((x1 ?? 0) - (x0 ?? 0)).toBeCloseTo(1e-6, 9)
  })
})

describe('visibleRuns', () => {
  const cell = (
    minX: number,
    edges: [number, number],
    caps: [number, number],
  ) => [minX, 0, minX + 100, 100, ...edges, ...caps]
  const cells = new Float32Array([
    ...cell(0, [0, 10], [0, 6]),
    ...cell(250, [10, 5], [6, 0]),
    ...cell(5000, [15, 7], [6, 3]),
  ])

  it('keeps the cells whose shadows can reach the view, merging neighbours', () => {
    expect(cells.length).toBe(3 * CELL_FLOATS)
    expect(visibleRuns(cells, [0, 0, 400, 100])).toEqual({
      edges: [[0, 15]],
      caps: [[0, 6]],
    })
  })

  it('includes cells up to the longest shadow away', () => {
    const far = visibleRuns(cells, [5100 + MAX_SHADOW_M - 1, 0, 6000, 100])
    expect(far.edges).toEqual([[15, 7]])
    expect(visibleRuns(cells, [5100 + MAX_SHADOW_M + 1, 0, 6000, 100])).toEqual(
      { edges: [], caps: [] },
    )
  })
})

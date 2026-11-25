import type { ExpressionSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import {
  DECKS_ZOOM,
  bridgeRoadFilter,
  hexColor,
  isBridgeRoadLayer,
  meshMatrix,
  meshOpacity,
  parseBridgeMesh,
  withNormals,
} from './bridgeMesh.ts'
import { RELIEF_ZOOM } from './camera.ts'

const decks: [number, number][][][] = [
  [
    [
      [-6.99, 38.87],
      [-6.98, 38.87],
      [-6.98, 38.88],
      [-6.99, 38.87],
    ],
  ],
]

describe('bridge mesh', () => {
  it('parses the file and rejects a malformed one', () => {
    const mesh = parseBridgeMesh({
      v: 1,
      origin: [-6.99, 38.87],
      triangles: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      decks,
    })
    expect(mesh.triangles).toHaveLength(9)
    expect(() => parseBridgeMesh({ v: 2, origin: [0, 0] })).toThrow()
  })

  it('gives each triangle its unit face normal', () => {
    // A triangle in the ground plane, and one standing up facing x.
    const out = withNormals([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1,
    ])
    expect(out).toHaveLength(36)
    expect([...out.slice(3, 6)]).toEqual([0, 0, 1])
    expect([...out.slice(15, 18)]).toEqual([0, 0, 1])
    expect([...out.slice(21, 24)]).toEqual([1, 0, 0])
    // A trailing partial triangle is ignored.
    expect(withNormals([0, 0, 0, 1])).toHaveLength(0)
  })

  it('scales metres to the frame for x, y and z alike', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const m = meshMatrix(identity, { origin: [0.5, 0.25], metresPerUnit: 1000 })
    expect(m[0]).toBeCloseTo(0.001)
    expect(m[5]).toBeCloseTo(0.001)
    expect(m[10]).toBeCloseTo(0.001)
    expect([m[12], m[13]]).toEqual([0.5, 0.25])
  })

  it('fades in with the 3D buildings', () => {
    expect(meshOpacity(RELIEF_ZOOM)).toBe(0)
    expect(meshOpacity(RELIEF_ZOOM + 0.15)).toBeCloseTo(0.5)
    expect(meshOpacity(RELIEF_ZOOM + 1)).toBe(1)
  })

  it('hands the bridge roads to the decks only from DECKS_ZOOM', () => {
    expect(DECKS_ZOOM).toBeGreaterThan(RELIEF_ZOOM)
    const own: ExpressionSpecification = ['==', ['get', 'brunnel'], 'bridge']
    expect(bridgeRoadFilter('bridge_street', own, decks, false)).toEqual(own)
    expect(bridgeRoadFilter('bridge_street', own, decks, true)).toEqual([
      'all',
      own,
      ['!', ['within', { type: 'MultiPolygon', coordinates: decks }]],
    ])
    expect(bridgeRoadFilter('road_area_pattern', null, decks, true)).toEqual([
      '!=',
      ['get', 'class'],
      'bridge',
    ])
    expect(bridgeRoadFilter('road_area_pattern', null, decks, false)).toBeNull()
    // A legacy filter is left as it is.
    expect(
      bridgeRoadFilter('bridge_street', ['==', 'class', 'minor'], decks, true),
    ).toEqual(['==', 'class', 'minor'])
  })

  it('touches only the bridge roads and the bridge areas', () => {
    expect(isBridgeRoadLayer('bridge_trunk_primary', 'line')).toBe(true)
    expect(isBridgeRoadLayer('road_area_pattern', 'fill')).toBe(true)
    expect(isBridgeRoadLayer('road_trunk_primary', 'line')).toBe(false)
    expect(isBridgeRoadLayer('bridge_label', 'symbol')).toBe(false)
  })

  it('reads #RRGGBB colours', () => {
    expect(hexColor('#FF8000')).toEqual([1, 128 / 255, 0])
  })
})

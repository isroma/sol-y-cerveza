import earcut from 'earcut'
import type { FeatureCollection, Polygon } from 'geojson'
import type { ExtrusionProperties } from './extrusionCodec.ts'

/** Metres along the equator per mercator unit (MapLibre's 0..1 world). */
const EARTH_CIRCUMFERENCE_M = 40075016.686
/** Side of a culling cell, in metres: the layer draws only cells near the view. */
export const CELL_M = 250

/** Floats per wall edge: its two ends (x, y) and its base and top heights. */
export const EDGE_FLOATS = 6
/** Floats per cap vertex: x, y and its height. */
export const CAP_FLOATS = 3
/** Floats per cell: bounds (min x, min y, max x, max y), then its runs of edges and cap indices (start, count). */
export const CELL_FLOATS = 8

/**
 * Where the prisms sit, in local metres around `origin`: x east, y south
 * (mercator's direction), so the map's matrix only needs a shift and a scale.
 */
export type PrismFrame = {
  /** The origin in mercator units (0..1). */
  origin: [number, number]
  /** Metres per mercator unit at the origin's latitude. */
  metresPerUnit: number
}

/**
 * The shadow casters as GPU-ready arrays, grouped by culling cell:
 * - `edges`: every ring edge, EDGE_FLOATS each, drawn as a quad from the edge
 *   at its base height to the edge at its top height, each pushed along the
 *   sun by its height;
 * - `caps` and `capIndices`: the triangulated outline of every prism that
 *   floats (tree crowns), pushed by its base height. A prism standing on the
 *   ground needs none: its walls' quads cover its whole shadow outside it.
 * - `cells`: CELL_FLOATS each.
 */
export type PrismArrays = {
  edges: Float32Array<ArrayBuffer>
  caps: Float32Array<ArrayBuffer>
  capIndices: Uint32Array<ArrayBuffer>
  cells: Float32Array<ArrayBuffer>
}

export function mercatorX(lon: number): number {
  return (lon + 180) / 360
}

export function mercatorY(lat: number): number {
  const r = (lat * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}

export function prismFrame(lon: number, lat: number): PrismFrame {
  return {
    origin: [mercatorX(lon), mercatorY(lat)],
    metresPerUnit: EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180),
  }
}

type Prism = {
  base: number
  top: number
  /** Rings in local metres, open, flat x, y. */
  rings: number[][]
  cx: number
  cy: number
  bounds: [number, number, number, number]
}

function toPrism(
  polygon: Polygon,
  { b, h }: ExtrusionProperties,
  frame: PrismFrame,
): Prism | null {
  if (!(h > b)) return null
  const bounds: [number, number, number, number] = [
    Infinity,
    Infinity,
    -Infinity,
    -Infinity,
  ]
  const rings: number[][] = []
  for (const ring of polygon.coordinates) {
    const flat: number[] = []
    // The closing point repeats the first: drop it.
    for (let i = 0; i + 1 < ring.length; i++) {
      const [lon = 0, lat = 0] = ring[i] ?? []
      const x = (mercatorX(lon) - frame.origin[0]) * frame.metresPerUnit
      const y = (mercatorY(lat) - frame.origin[1]) * frame.metresPerUnit
      flat.push(x, y)
      bounds[0] = Math.min(bounds[0], x)
      bounds[1] = Math.min(bounds[1], y)
      bounds[2] = Math.max(bounds[2], x)
      bounds[3] = Math.max(bounds[3], y)
    }
    if (flat.length >= 6) rings.push(flat)
  }
  if (!rings.length) return null
  return {
    base: b,
    top: h,
    rings,
    cx: (bounds[0] + bounds[2]) / 2,
    cy: (bounds[1] + bounds[3]) / 2,
    bounds,
  }
}

/**
 * Builds the arrays for every polygon of the extrusion files (extrusionCodec.ts).
 * With `leafOff`, deciduous crowns (`d: 1`) cast nothing: they are bare.
 */
export function prismArrays(
  collections: readonly FeatureCollection<Polygon, ExtrusionProperties>[],
  frame: PrismFrame,
  leafOff = false,
): PrismArrays {
  const byCell = new Map<string, Prism[]>()
  let edgeCount = 0
  let capVertices = 0
  let capTriangles = 0
  for (const collection of collections) {
    for (const { geometry, properties } of collection.features) {
      if (leafOff && properties.d === 1) continue
      const prism = toPrism(geometry, properties, frame)
      if (!prism) continue
      const key = `${Math.floor(prism.cy / CELL_M)},${Math.floor(prism.cx / CELL_M)}`
      let list = byCell.get(key)
      if (!list) byCell.set(key, (list = []))
      list.push(prism)
      for (const ring of prism.rings) edgeCount += ring.length / 2
      if (prism.base > 0) {
        const n = prism.rings.reduce((sum, ring) => sum + ring.length / 2, 0)
        capVertices += n
        capTriangles += n + 2 * (prism.rings.length - 1)
      }
    }
  }
  // Row by row, so neighbouring cells in a row are neighbours in the arrays
  // and a view's cells merge into a few draw calls.
  const keys = [...byCell.keys()].sort((a, b) => {
    const [ra = 0, ca = 0] = a.split(',').map(Number)
    const [rb = 0, cb = 0] = b.split(',').map(Number)
    return ra - rb || ca - cb
  })
  const edges = new Float32Array(edgeCount * EDGE_FLOATS)
  const caps = new Float32Array(capVertices * CAP_FLOATS)
  const indices = new Uint32Array(capTriangles * 3)
  const cells = new Float32Array(keys.length * CELL_FLOATS)
  let e = 0
  let v = 0
  let t = 0
  keys.forEach((key, c) => {
    const prisms = byCell.get(key) ?? []
    const edgeStart = e
    const indexStart = t
    const bounds = [Infinity, Infinity, -Infinity, -Infinity]
    for (const prism of prisms) {
      bounds[0] = Math.min(bounds[0] ?? 0, prism.bounds[0])
      bounds[1] = Math.min(bounds[1] ?? 0, prism.bounds[1])
      bounds[2] = Math.max(bounds[2] ?? 0, prism.bounds[2])
      bounds[3] = Math.max(bounds[3] ?? 0, prism.bounds[3])
      for (const ring of prism.rings) {
        const n = ring.length / 2
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n
          edges.set(
            [
              ring[2 * i] ?? 0,
              ring[2 * i + 1] ?? 0,
              ring[2 * j] ?? 0,
              ring[2 * j + 1] ?? 0,
              prism.base,
              prism.top,
            ],
            e * EDGE_FLOATS,
          )
          e++
        }
      }
      if (prism.base > 0) {
        const flat: number[] = []
        const holes: number[] = []
        for (const ring of prism.rings) {
          if (flat.length) holes.push(flat.length / 2)
          flat.push(...ring)
        }
        const first = v
        for (let i = 0; i < flat.length; i += 2) {
          caps.set([flat[i] ?? 0, flat[i + 1] ?? 0, prism.base], v * CAP_FLOATS)
          v++
        }
        for (const index of earcut(flat, holes)) indices[t++] = first + index
      }
    }
    cells.set(
      [...bounds, edgeStart, e - edgeStart, indexStart, t - indexStart],
      c * CELL_FLOATS,
    )
  })
  return { edges, caps, capIndices: indices.slice(0, t), cells }
}

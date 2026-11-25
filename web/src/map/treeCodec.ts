import type { Feature, FeatureCollection, Polygon, Position } from 'geojson'
import * as z from 'zod/mini'

/** Coordinates in trees.json are integers in this unit (1e-5°, about 1 m). */
const UNIT = 1e5

/**
 * trees.json, written by the pipeline (trees.py): crowns grouped by extrusion,
 * `[base m, top m, polygons]`. A polygon is a list of rings, a ring a flat list
 * of `x, y` steps in UNIT, open (the closing point is implied). Each step is
 * from the previous point; a ring's first point is from the first point of the
 * ring before it, so the numbers stay small.
 */
const TreesFile = z.object({
  v: z.literal(1),
  g: z.array(
    z.tuple([z.number(), z.number(), z.array(z.array(z.array(z.int())))]),
  ),
})

export type TreeProperties = { b: number; h: number }

/** trees.json as GeoJSON polygons with their `b` base and `h` top. */
export function decodeTrees(
  raw: unknown,
): FeatureCollection<Polygon, TreeProperties> {
  const { g } = TreesFile.parse(raw)
  const features: Feature<Polygon, TreeProperties>[] = []
  let firstX = 0
  let firstY = 0
  for (const [b, h, polygons] of g) {
    for (const rings of polygons) {
      const coordinates = rings.map((steps) => {
        let x = firstX
        let y = firstY
        const ring: Position[] = []
        for (let i = 0; i + 1 < steps.length; i += 2) {
          x += steps[i] ?? 0
          y += steps[i + 1] ?? 0
          if (i === 0) [firstX, firstY] = [x, y]
          ring.push([x / UNIT, y / UNIT])
        }
        const start = ring[0]
        if (start) ring.push(start)
        return ring
      })
      features.push({
        type: 'Feature',
        properties: { b, h },
        geometry: { type: 'Polygon', coordinates },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

/**
 * Custom protocol for the crowns: `trees://<absolute url of trees.json, URI-encoded>`
 * (encoded, because MapLibre collapses a `//` inside the URL).
 */
export const TREES_PROTOCOL = 'trees'

/** The protocol's handler, in MapLibre's workers or, as a fallback, on the main thread. */
export async function loadTrees(
  params: { url: string },
  abort: AbortController,
): Promise<{ data: FeatureCollection<Polygon, TreeProperties> }> {
  const url = decodeURIComponent(
    params.url.slice(`${TREES_PROTOCOL}://`.length),
  )
  const response = await fetch(url, { signal: abort.signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return { data: decodeTrees(await response.json()) }
}

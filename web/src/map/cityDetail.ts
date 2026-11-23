import type { FeatureCollection, Polygon } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import { BUILDING_HEIGHT_SCALE } from './camera.ts'

/**
 * Detail for the 3D view (demo, docs/design/README.md "3D city"):
 * - window textures on walls, a few stucco tints spread over the buildings;
 * - umbrellas at each terrace's real position;
 * - trees from the LiDAR (pipeline `solycerveza.trees`), drawn as simple
 *   trunks and two-tier crowns.
 * Windows, tints and umbrella layout are decorative; positions are real.
 */

/** Whitewash, cream and pale ochre: Badajoz façades. */
export const WALL_TINTS = ['#F2E6D6', '#F6EFE4', '#EFDCC2'] as const
export const WALL_IMAGES = WALL_TINTS.map((_, i) => `wall-${i}`)

/** Pick a tint per building from its feature id, so it never changes. */
export const WALL_PATTERN: ExpressionSpecification = [
  'match',
  [
    '%',
    // The tile feature id when there is one, else the height: stable either way.
    ['round', ['to-number', ['id'], ['get', 'render_height'], 0]],
    WALL_TINTS.length,
  ],
  0,
  WALL_IMAGES[0] ?? 'wall-0',
  1,
  WALL_IMAGES[1] ?? 'wall-1',
  WALL_IMAGES[2] ?? 'wall-2',
]

/** Two bays wide and two floors tall, in texture pixels. */
const BAY = 12
const FLOOR = 14
export const TEXTURE_WIDTH = 2 * BAY
export const TEXTURE_HEIGHT = 2 * FLOOR

const NIGHT_WALL = '#2A3044'
const GLASS_DAY = '#B9B4AC'
const SILL_DAY = '#FFFFFF'
const LIT = '#FFD58A'
const DARK_GLASS = '#1B2030'

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export type Texture = { width: number; height: number; data: Uint8Array }

/**
 * A wall tile: plain wall with one window per bay and floor, a light sill
 * under each by day; at night a dark wall where some windows are lit.
 */
export function wallTexture(tint: number, night: boolean): Texture {
  const width = TEXTURE_WIDTH
  const height = TEXTURE_HEIGHT
  const data = new Uint8Array(width * height * 4)
  const paint = (x0: number, y0: number, w: number, h: number, hex: string) => {
    const [r, g, b] = rgb(hex)
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * width + x) * 4
        data[i] = r
        data[i + 1] = g
        data[i + 2] = b
        data[i + 3] = 255
      }
  }
  paint(
    0,
    0,
    width,
    height,
    night ? NIGHT_WALL : (WALL_TINTS[tint] ?? '#F2E6D6'),
  )
  for (let floor = 0; floor < 2; floor++)
    for (let bay = 0; bay < 2; bay++) {
      const x = bay * BAY + 4
      const y = floor * FLOOR + 4
      // At night, a different window is lit on each tint.
      const lit = (floor * 2 + bay + tint) % 3 === 0
      paint(x, y, 5, 7, night ? (lit ? LIT : DARK_GLASS) : GLASS_DAY)
      if (!night) paint(x - 1, y + 7, 7, 1, SILL_DAY)
    }
  return { width, height, data }
}

const EARTH_M = 6_371_000

/** A polygon approximating a circle of `radius` metres around (lon, lat). */
export function circle(
  lon: number,
  lat: number,
  radius: number,
  sides = 12,
): Polygon {
  const dLat = (radius / EARTH_M) * (180 / Math.PI)
  const dLon = dLat / Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= sides; i++) {
    const a = (i / sides) * 2 * Math.PI
    ring.push([
      Math.round((lon + dLon * Math.cos(a)) * 1e7) / 1e7,
      Math.round((lat + dLat * Math.sin(a)) * 1e7) / 1e7,
    ])
  }
  return { type: 'Polygon', coordinates: [ring] }
}

export type Solid = { base: number; top: number; color: string }

const S = BUILDING_HEIGHT_SCALE
/** Five umbrellas per terrace, mostly south of its point so the badge, which
 *  rises north of it on screen, doesn't hide them (metres east, north). */
const UMBRELLA_OFFSETS: [number, number][] = [
  [0, -3.5],
  [4.5, -2],
  [-4.5, -2],
  [2.5, -7.5],
  [-2.5, -7.5],
]
const UMBRELLA_COLOR = '#FBF6EC'
const POLE_COLOR = '#8A7B66'

/** Pole and canopy extrusions for every terrace position. */
export function umbrellaFeatures(
  terraces: readonly { lon: number; lat: number }[],
): FeatureCollection<Polygon, Solid> {
  const features: FeatureCollection<Polygon, Solid>['features'] = []
  for (const { lon, lat } of terraces)
    for (const [east, north] of UMBRELLA_OFFSETS) {
      const dLat = (north / EARTH_M) * (180 / Math.PI)
      const dLon =
        ((east / EARTH_M) * (180 / Math.PI)) / Math.cos((lat * Math.PI) / 180)
      const x = lon + dLon
      const y = lat + dLat
      features.push(
        {
          type: 'Feature',
          geometry: circle(x, y, 0.15, 6),
          properties: { base: 0, top: 2.2 * S, color: POLE_COLOR },
        },
        {
          type: 'Feature',
          geometry: circle(x, y, 1.7),
          properties: { base: 2.1 * S, top: 2.45 * S, color: UMBRELLA_COLOR },
        },
      )
    }
  return { type: 'FeatureCollection', features }
}

const TRUNK = '#8C7257'
const CROWN = '#9DC47E'
const CROWN_TOP = '#B3D394'

/** Trunk and a two-tier crown per tree: [lon, lat, height m, crown radius m]. */
export function treeFeatures(
  trees: readonly (readonly [number, number, number, number])[],
): FeatureCollection<Polygon, Solid> {
  const features: FeatureCollection<Polygon, Solid>['features'] = []
  for (const [lon, lat, height, radius] of trees) {
    const crownBase = height * 0.4
    const middle = height * 0.75
    features.push(
      {
        type: 'Feature',
        geometry: circle(lon, lat, 0.25, 6),
        properties: { base: 0, top: crownBase * S, color: TRUNK },
      },
      {
        type: 'Feature',
        geometry: circle(lon, lat, radius),
        properties: { base: crownBase * S, top: middle * S, color: CROWN },
      },
      {
        type: 'Feature',
        geometry: circle(lon, lat, radius * 0.65),
        properties: { base: middle * S, top: height * S, color: CROWN_TOP },
      },
    )
  }
  return { type: 'FeatureCollection', features }
}

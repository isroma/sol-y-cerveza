import type {
  ExpressionSpecification,
  LayerSpecification,
  LightSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import { z } from 'zod'
import type { SunPosition } from '../sun/sunState.ts'
import { BUILDING_HEIGHT_SCALE, EXTRUSION_OPACITY } from './camera.ts'

/**
 * The minimal shape of a MapLibre style, checked before the basemap's JSON
 * reaches MapLibre. MapLibre validates the rest itself. Only a check: the
 * JSON itself goes on, with all its keys. (catchall rather than z.record or
 * z.looseObject, which would add ~4.6 kB of zod to the entry chunk.)
 */
const basemapStyleSchema = z.object({
  version: z.literal(8),
  sources: z.object({}).catchall(z.object({ type: z.string() })),
  layers: z.array(z.object({ id: z.string(), type: z.string() })),
})

function isStyleSpecification(value: unknown): value is StyleSpecification {
  return basemapStyleSchema.safeParse(value).success
}

/** The basemap style from its JSON; throws when it isn't a style. */
export function parseBasemapStyle(json: unknown): StyleSpecification {
  if (!isStyleSpecification(json))
    throw new Error('the basemap style is not a MapLibre style')
  return json
}

/** Dropped: POI icons (the venue pins are the points of interest) and road clutter. */
const DROPPED_LAYERS = new Set([
  'poi_r20',
  'poi_r7',
  'poi_transit',
  'road_one_way_arrow',
  'road_one_way_arrow_opposite',
  'highway-shield-non-us',
  'highway-shield-us-interstate',
  'road_shield_us',
  'airport',
])

/** Landmark labels (Alcazaba, Plaza Alta…) kept as text, without icons. */
const TEXT_ONLY_LAYERS = new Set(['poi_r1'])

/** Warm, Apple Maps-like palette: sandy land, white streets, soft blue water. */
const PAINT: Record<string, Record<string, unknown>> = {
  background: { 'background-color': '#F6EEE2' },
  landuse_residential: { 'fill-color': '#F1E5D2', 'fill-opacity': 0.7 },
  park: {
    'fill-color': '#CDE5AE',
    'fill-opacity': 0.95,
    'fill-outline-color': '#CDE5AE',
  },
  park_outline: { 'line-color': '#C2DDA0' },
  landcover_wood: { 'fill-color': '#BFDDA0', 'fill-opacity': 0.7 },
  landcover_grass: { 'fill-color': '#CDE5AE', 'fill-opacity': 0.7 },
  landuse_pitch: { 'fill-color': '#D3E6BC' },
  landuse_school: { 'fill-color': '#F0E2D0' },
  landuse_hospital: { 'fill-color': '#F6DEDB' },
  water: { 'fill-color': '#9ACBEF' },
  waterway_river: { 'line-color': '#9ACBEF' },
  waterway_other: { 'line-color': '#9ACBEF' },
  building: { 'fill-color': '#F0E4D3', 'fill-outline-color': '#E5D5BF' },
  'building-3d': {
    // Whitewashed, warm stucco walls; the light shades the sides.
    'fill-extrusion-color': '#F2E6D6',
    'fill-extrusion-opacity': EXTRUSION_OPACITY,
    'fill-extrusion-height': [
      '*',
      BUILDING_HEIGHT_SCALE,
      ['get', 'render_height'],
    ],
    'fill-extrusion-base': [
      '*',
      BUILDING_HEIGHT_SCALE,
      ['coalesce', ['get', 'render_min_height'], 0],
    ],
    'fill-extrusion-vertical-gradient': true,
  },
  poi_r1: { 'text-color': '#6B5E4B', 'text-halo-color': '#FFFFFF' },
  'highway-name-minor': { 'text-color': '#8A7B66' },
  'highway-name-major': { 'text-color': '#7A6B55' },
  waterway_line_label: { 'text-color': '#4D8BC4' },
}

const ROAD = /^(road|bridge|tunnel)_/

/** Streets: white with a soft sand casing; rails faint. Apple Maps style. */
function roadPaint(layer: LayerSpecification): Record<string, unknown> | null {
  if (layer.type !== 'line' || !ROAD.test(layer.id)) return null
  if (layer.id.includes('rail')) return { 'line-color': '#D9CDBC' }
  // Dotted footpaths clutter the overview: show them only up close.
  if (layer.id.includes('path_pedestrian'))
    return {
      'line-color': '#FFFFFF',
      'line-opacity': ['interpolate', ['linear'], ['zoom'], 15.5, 0, 16.5, 1],
    }
  if (layer.id.endsWith('_casing')) {
    const major = /motorway|trunk|primary|secondary|link/.test(layer.id)
    return { 'line-color': major ? '#E6CFA8' : '#E4D6C3' }
  }
  return { 'line-color': '#FFFFFF' }
}

function textOnly(layer: LayerSpecification): LayerSpecification {
  if (layer.type !== 'symbol') return layer
  const layout = { ...layer.layout }
  delete layout['icon-image']
  return { ...layer, layout: { ...layout, 'text-offset': [0, 0] } }
}

/**
 * The warm, light "sun-lit" look: OpenFreeMap's Liberty style recoloured,
 * with 3D buildings and without POI icons. Pure, so it is easy to test.
 */
export function sunlitStyle(base: StyleSpecification): StyleSpecification {
  const layers: LayerSpecification[] = base.layers
    .filter((layer) => !DROPPED_LAYERS.has(layer.id))
    .map((layer) => (TEXT_ONLY_LAYERS.has(layer.id) ? textOnly(layer) : layer))
    .map((layer) => {
      const paint = PAINT[layer.id] ?? roadPaint(layer) ?? undefined
      if (paint === undefined || !('paint' in layer || layer.type === 'symbol'))
        return layer
      const current = 'paint' in layer ? layer.paint : undefined
      return { ...layer, paint: { ...current, ...paint } } as LayerSpecification
    })
  return { ...base, layers: withRoofs(layers) }
}

/** Roof caps a touch lighter than the walls, so roofs read clearly from above. */
export const ROOF_COLOR = '#FCF8F1'
/** Thickness of a roof cap, in metres (before BUILDING_HEIGHT_SCALE). */
const ROOF_M = 0.6

/**
 * Adds a thin, lighter roof cap on top of every 3D building: a second
 * extrusion over the same buildings, from the roof up by ROOF_M. Walls keep
 * their colour and lighting; roofs stand out against the streets.
 */
function withRoofs(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.flatMap((layer) => {
    if (layer.id !== 'building-3d' || layer.type !== 'fill-extrusion')
      return [layer]
    const top: ExpressionSpecification = [
      '*',
      BUILDING_HEIGHT_SCALE,
      ['get', 'render_height'],
    ]
    const roof: LayerSpecification = {
      ...layer,
      id: 'building-roof',
      paint: {
        'fill-extrusion-color': ROOF_COLOR,
        'fill-extrusion-opacity': EXTRUSION_OPACITY,
        'fill-extrusion-base': top,
        'fill-extrusion-height': ['+', top, ROOF_M * BUILDING_HEIGHT_SCALE],
        'fill-extrusion-vertical-gradient': false,
      },
    }
    return [layer, roof]
  })
}

/** Fixed light elevation (polar angle from straight up) that keeps roofs bright. */
const LIGHT_POLAR = 35

/**
 * Map light for the 3D buildings. It comes from the sun's real azimuth, so the
 * sunlit facades turn with the time, but at a fixed, flattering elevation:
 * MapLibre darkens roofs as the light drops, and the real elevation is shown
 * by the cast shadows instead (see shadows.ts).
 */
export function sunLight(sun: SunPosition): LightSpecification {
  if (sun.altitude <= 0) {
    return {
      anchor: 'map',
      position: [1.15, 0, LIGHT_POLAR],
      color: '#D5DAEC',
      intensity: 0.25,
    }
  }
  const lowSun = sun.altitude < 12
  return {
    anchor: 'map',
    // [radial, azimuth from north clockwise, polar angle from straight up]
    position: [1.15, sun.azimuth, LIGHT_POLAR],
    color: lowSun ? '#FFE7C4' : '#FFF6EA',
    intensity: 0.2,
  }
}

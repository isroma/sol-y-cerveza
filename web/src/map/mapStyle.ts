import type {
  LayerSpecification,
  LightSpecification,
  StyleSpecification,
} from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'

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

const PAINT: Record<string, Record<string, unknown>> = {
  background: { 'background-color': '#F3EEE5' },
  landuse_residential: { 'fill-color': '#EEE6D8', 'fill-opacity': 0.6 },
  park: {
    'fill-color': '#CFE3B4',
    'fill-opacity': 0.9,
    'fill-outline-color': '#CFE3B4',
  },
  landcover_wood: { 'fill-color': '#BFD9A0', 'fill-opacity': 0.6 },
  landcover_grass: { 'fill-color': '#CFE3B4', 'fill-opacity': 0.6 },
  water: { 'fill-color': '#8EC5E8' },
  waterway_river: { 'line-color': '#8EC5E8' },
  building: { 'fill-color': '#E7DFD1', 'fill-outline-color': '#DDD3C2' },
  'building-3d': {
    'fill-extrusion-color': '#FFF8EC',
    'fill-extrusion-opacity': 1,
    'fill-extrusion-vertical-gradient': true,
  },
  poi_r1: { 'text-color': '#6B5E4B', 'text-halo-color': '#FFFFFF' },
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
      const paint = PAINT[layer.id]
      if (paint === undefined || !('paint' in layer || layer.type === 'symbol'))
        return layer
      const current = 'paint' in layer ? layer.paint : undefined
      return { ...layer, paint: { ...current, ...paint } } as LayerSpecification
    })
  return { ...base, layers }
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
    color: lowSun ? '#FFE7C4' : '#FFFFFF',
    intensity: 0.4,
  }
}

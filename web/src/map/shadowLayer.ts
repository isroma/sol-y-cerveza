import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'
import { BUILDING_HEIGHT_SCALE } from './camera.ts'
import { buildingShadow, type LonLat } from './shadows.ts'

type ShadowFeature = {
  type: 'Feature'
  geometry: { type: 'MultiPolygon'; coordinates: LonLat[][][] }
  properties: Record<string, never>
}

const EMPTY = {
  type: 'FeatureCollection' as const,
  features: [] as ShadowFeature[],
}

/** Each footprint polygon with all its rings (outer first, then courtyards). */
function polygons(geometry: MapGeoJSONFeature['geometry']): LonLat[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as LonLat[][]]
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates as LonLat[][][]
  return []
}

/**
 * Shadows of the buildings in the loaded vector tiles (OpenMapTiles
 * `building` layer, `render_height` in metres) for the given sun.
 */
export function shadowCollection(map: MapLibreMap, sun: SunPosition) {
  if (sun.altitude <= 0 || map.getZoom() < 14) return EMPTY
  const features: ShadowFeature[] = []
  for (const feature of map.querySourceFeatures('openmaptiles', {
    sourceLayer: 'building',
  })) {
    // Same exaggeration as the 3D buildings, so shadows match what is drawn.
    const height =
      Number(feature.properties['render_height'] ?? 0) * BUILDING_HEIGHT_SCALE
    if (!(height > 0)) continue
    for (const polygon of polygons(feature.geometry)) {
      const quads = buildingShadow(polygon, height, sun)
      if (quads && quads.length > 0) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'MultiPolygon',
            coordinates: quads.map((quad) => [quad]),
          },
          properties: {},
        })
      }
    }
  }
  return { type: 'FeatureCollection' as const, features }
}

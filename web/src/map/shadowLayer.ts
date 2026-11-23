import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'
import { BUILDING_HEIGHT_SCALE } from './camera.ts'
import { buildingShadow, type LonLat } from './shadows.ts'

type ShadowFeature = {
  type: 'Feature'
  geometry: { type: 'Polygon'; coordinates: LonLat[][] }
  properties: Record<string, never>
}

const EMPTY = {
  type: 'FeatureCollection' as const,
  features: [] as ShadowFeature[],
}

function outerRings(geometry: MapGeoJSONFeature['geometry']): LonLat[][] {
  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0]
    return ring ? [ring as LonLat[]] : []
  }
  if (geometry.type === 'MultiPolygon') {
    const polygons: readonly (readonly (readonly number[])[])[][] =
      geometry.coordinates
    return polygons.flatMap((polygon) =>
      polygon[0] ? [polygon[0] as LonLat[]] : [],
    )
  }
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
    for (const ring of outerRings(feature.geometry)) {
      const shadow = buildingShadow(ring, height, sun)
      if (shadow && shadow.length >= 4) {
        features.push({
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [shadow] },
          properties: {},
        })
      }
    }
  }
  return { type: 'FeatureCollection' as const, features }
}

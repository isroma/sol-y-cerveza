import type {
  FillExtrusionLayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl'
import { EXTRUSION_OPACITY } from './camera.ts'
import { addExtrusionSource, type ExtrusionMap } from './extrusionSource.ts'
import { ROOF_COLOR, ROOF_M, WALL_COLOR } from './mapStyle.ts'

export const LIDAR_BUILDINGS = 'lidar-buildings'
export const LIDAR_ROOFS = 'lidar-buildings-roof'
/**
 * Deployed from the height-tiles branch; in dev, written by the pipeline
 * (buildings.py). A compact format, decoded by extrusionCodec.ts.
 */
export const BUILDINGS_URL = './data/buildings.json'
/** The basemap layers these replace: its 3D buildings start at this zoom. */
export const BASEMAP_BUILDINGS = ['building-3d', 'building-roof'] as const
const BUILDINGS_ZOOM = 14

/**
 * OSM buildings at their LiDAR heights (each feature's `h`, in metres), with
 * the basemap's look: walls and a lighter roof cap. Real heights, as the
 * shadows (prismShadows.ts) and the list use.
 */
export const LIDAR_BUILDING_LAYERS: readonly FillExtrusionLayerSpecification[] =
  [
    {
      id: LIDAR_BUILDINGS,
      type: 'fill-extrusion',
      source: LIDAR_BUILDINGS,
      minzoom: BUILDINGS_ZOOM,
      paint: {
        'fill-extrusion-color': WALL_COLOR,
        'fill-extrusion-opacity': EXTRUSION_OPACITY,
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-vertical-gradient': true,
      },
    },
    {
      id: LIDAR_ROOFS,
      type: 'fill-extrusion',
      source: LIDAR_BUILDINGS,
      minzoom: BUILDINGS_ZOOM,
      paint: {
        'fill-extrusion-color': ROOF_COLOR,
        'fill-extrusion-opacity': EXTRUSION_OPACITY,
        'fill-extrusion-base': ['get', 'h'],
        'fill-extrusion-height': ['+', ['get', 'h'], ROOF_M],
        'fill-extrusion-vertical-gradient': false,
      },
    },
  ]

/**
 * Draws the LiDAR buildings, before the layer `before` when given. Resolves
 * to whether the file loaded; until then (and for good if it never does) the
 * basemap's own 3D buildings stay, so the map always has buildings.
 */
export function addLidarBuildings(
  map: ExtrusionMap & Pick<MapLibreMap, 'addLayer'>,
  before: string | undefined,
): Promise<boolean> {
  const loaded = addExtrusionSource(map, LIDAR_BUILDINGS, BUILDINGS_URL)
  for (const layer of LIDAR_BUILDING_LAYERS) map.addLayer(layer, before)
  return loaded
}

/**
 * Hides the basemap's 3D buildings once the LiDAR ones are in. They stay in
 * the style, so the night paint is unchanged.
 */
export function hideBasemapBuildings(
  map: Pick<MapLibreMap, 'getLayer' | 'setLayoutProperty'>,
) {
  for (const id of BASEMAP_BUILDINGS)
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none')
}

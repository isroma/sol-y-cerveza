import type {
  FillExtrusionLayerSpecification,
  Map as MapLibreMap,
} from 'maplibre-gl'
import { EXTRUSION_OPACITY, RELIEF_ZOOM } from './camera.ts'
import { addExtrusionSource, type ExtrusionMap } from './extrusionSource.ts'

export const TREES = 'tree-crowns'
/**
 * Deployed from the height-tiles branch; in dev, written by the pipeline
 * (trees.py). A compact format, decoded by extrusionCodec.ts.
 */
export const TREES_URL = './data/trees.json'
/** A deeper sage than the parks (#CDE5AE), so crowns stand out from the grass under them. */
export const TREE_COLOR = '#A8C98C'

/**
 * Tree crowns from the LiDAR, extruded in height bands (each feature's `b`
 * base and `h` top, in metres), with the 3D buildings and under them in the
 * layer order. MapLibre fetches and tiles the file in its worker.
 */
export const TREE_LAYER: FillExtrusionLayerSpecification = {
  id: TREES,
  type: 'fill-extrusion',
  source: TREES,
  minzoom: RELIEF_ZOOM,
  paint: {
    'fill-extrusion-color': TREE_COLOR,
    'fill-extrusion-opacity': EXTRUSION_OPACITY,
    'fill-extrusion-base': ['get', 'b'],
    'fill-extrusion-height': ['get', 'h'],
    'fill-extrusion-vertical-gradient': true,
  },
}

/** Adds the crowns, drawn before the layer `before` (the 3D buildings) when given. */
export function addTreeCrowns(
  map: ExtrusionMap & Pick<MapLibreMap, 'addLayer'>,
  before: string | undefined,
) {
  addExtrusionSource(map, TREES, TREES_URL)
  map.addLayer(TREE_LAYER, before)
}

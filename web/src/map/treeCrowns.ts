import {
  addProtocol,
  importScriptInWorkers,
  type FillExtrusionLayerSpecification,
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { EXTRUSION_OPACITY, RELIEF_ZOOM } from './camera.ts'
import { loadTrees, TREES_PROTOCOL } from './treeCodec.ts'
import treesWorkerUrl from './treesWorker.ts?worker&url'

export const TREES = 'tree-crowns'
/**
 * Deployed from the height-tiles branch; in dev, written by the pipeline
 * (trees.py). A compact format, decoded by treeCodec.ts.
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

/** The source's data: trees.json through the `trees` protocol. */
export function treesData(page: string): string {
  return `${TREES_PROTOCOL}://${encodeURIComponent(new URL(TREES_URL, page).href)}`
}

/**
 * Adds the crowns, drawn before the layer `before` (the 3D buildings) when
 * given. The layer is there at once (empty), so the night paint covers it; the
 * data follows once MapLibre's workers have the decoder (treesWorker.ts). The
 * main thread decodes too, should a worker not have it.
 */
export function addTreeCrowns(
  map: Pick<MapLibreMap, 'addSource' | 'addLayer' | 'getSource'>,
  before: string | undefined,
) {
  map.addSource(TREES, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  map.addLayer(TREE_LAYER, before)
  addProtocol(TREES_PROTOCOL, loadTrees)
  const load = () =>
    map.getSource<GeoJSONSource>(TREES)?.setData(treesData(location.href))
  // MapLibre import()s a URL ending in .mjs as it is; any other it fetches and
  // runs from a blob: URL, where the module's own imports (in dev) can't resolve.
  importScriptInWorkers(
    `${new URL(treesWorkerUrl, location.href).href}#.mjs`,
  ).then(load, load)
}

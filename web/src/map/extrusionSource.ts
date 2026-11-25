import {
  addProtocol,
  GeoJSONSource,
  importScriptInWorkers,
  type Map as MapLibreMap,
} from 'maplibre-gl'
import { EXTRUSIONS_PROTOCOL, loadExtrusions } from './extrusionCodec.ts'
import workerUrl from './extrusionWorker.ts?worker&url'

/** Deepest zoom the extrusion sources are tiled at (1 unit ≈ 7 cm at z16). */
export const EXTRUSION_MAX_ZOOM = 16

export type ExtrusionMap = Pick<MapLibreMap, 'addSource' | 'getSource'>

/** A source's data: the file at `url` through the `extrusions` protocol. */
export function extrusionData(url: string, page: string): string {
  return `${EXTRUSIONS_PROTOCOL}://${encodeURIComponent(new URL(url, page).href)}`
}

/**
 * Adds GeoJSON source `id` for an extrusion file (extrusionCodec.ts). The
 * source is there at once, empty, so its layers can be added (and the night
 * paint covers them); the data follows once MapLibre's workers have the
 * decoder (extrusionWorker.ts). The main thread decodes too, should a worker
 * not have it.
 */
export function addExtrusionSource(map: ExtrusionMap, id: string, url: string) {
  map.addSource(id, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    // Tiled up to here and overzoomed past it, like the basemap: closer in,
    // every turn of a street view would cut and upload new tiles.
    maxzoom: EXTRUSION_MAX_ZOOM,
  })
  addProtocol(EXTRUSIONS_PROTOCOL, loadExtrusions)
  const load = () => {
    const source = map.getSource(id)
    if (source instanceof GeoJSONSource)
      source.setData(extrusionData(url, location.href))
  }
  // MapLibre import()s a URL ending in .mjs as it is; any other it fetches and
  // runs from a blob: URL, where the module's own imports (in dev) can't resolve.
  importScriptInWorkers(`${new URL(workerUrl, location.href).href}#.mjs`).then(
    load,
    load,
  )
}

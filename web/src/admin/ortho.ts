import type {
  LayerSpecification,
  RasterLayerSpecification,
  RasterSourceSpecification,
  StyleSpecification,
} from 'maplibre-gl'

/**
 * The PNOA orthophoto (máxima actualidad, IGN) as the admin's optional basemap,
 * the same imagery the pipeline reads (`pipeline/src/solycerveza/ortho.py`).
 * WMTS rather than the WMS the pipeline uses: its GoogleMapsCompatible tile
 * matrix set is the Web Mercator XYZ grid MapLibre asks for, so tiles are cut
 * and cached by the server, not rendered per request.
 */
export const ORTHO_TILES =
  'https://www.ign.es/wmts/pnoa-ma?service=WMTS&request=GetTile&version=1.0.0' +
  '&layer=OI.OrthoimageCoverage&style=default&format=image/jpeg' +
  '&tilematrixset=GoogleMapsCompatible&tilematrix={z}&tilerow={y}&tilecol={x}'

/**
 * Highest zoom fetched. At Badajoz's latitude a zoom-19 pixel is about 0.23 m,
 * the PNOA's own resolution (25 cm here), so deeper tiles would add no detail:
 * MapLibre overzooms zoom 19 up to the map's maxZoom (21).
 */
export const ORTHO_MAX_ZOOM = 19

/**
 * CC BY 4.0 credit, in IGN's wording. AdminMap shows it next to the toggle
 * while the layer is on, not in MapLibre's attribution control, which folds
 * into an "i" button on narrow maps.
 */
export const ORTHO_CREDIT =
  'PNOA cedido por © Instituto Geográfico Nacional de España'

export const ORTHO_SOURCE = 'pnoa'
export const ORTHO_LAYER = 'pnoa-ortho'

export const orthoSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: [ORTHO_TILES],
  tileSize: 256,
  maxzoom: ORTHO_MAX_ZOOM,
}

export function orthoLayer(visible: boolean): RasterLayerSpecification {
  return {
    id: ORTHO_LAYER,
    type: 'raster',
    source: ORTHO_SOURCE,
    layout: { visibility: visible ? 'visible' : 'none' },
  }
}

/**
 * The layer the photo goes under: the basemap's first label, so street names
 * stay readable on top of it while roads, buildings and land are covered.
 */
export function orthoBeforeId(style: StyleSpecification): string | undefined {
  return style.layers.find(
    (layer: LayerSpecification) => layer.type === 'symbol',
  )?.id
}

/** Venue dots: a dark ring on the flat map, a white one on the photo. */
export function dotStroke(ortho: boolean): { color: string; width: number } {
  return ortho
    ? { color: '#FFFFFF', width: 2 }
    : { color: '#3B3228', width: 1.2 }
}

const STORAGE_KEY = 'admin-ortho'

/** The owner's last choice, per browser; the flat map when storage is unavailable. */
export function loadOrthoPreference(storage?: Storage): boolean {
  try {
    return (storage ?? localStorage).getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function saveOrthoPreference(on: boolean, storage?: Storage): void {
  try {
    ;(storage ?? localStorage).setItem(STORAGE_KEY, on ? '1' : '0')
  } catch {
    // Private window or blocked storage: the toggle still works for this visit.
  }
}

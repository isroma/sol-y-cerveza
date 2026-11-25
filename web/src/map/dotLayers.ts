import type { Map as MapLibreMap } from 'maplibre-gl'
import { dotsData } from './dots.ts'

export const DOTS_SOURCE = 'venues-unconfirmed'
export const DOTS_LAYER = 'venues-unconfirmed'
export const LABELS_LAYER = 'venues-unconfirmed-labels'
/** From this zoom, unconfirmed venues show their name next to the dot. */
const LABELS_ZOOM = 16.5

/**
 * A click inside the venue card (e.g. its price form) is not a map click.
 * Uses the path recorded at dispatch: React may have already replaced the
 * clicked element (a button that opens a form) by the time the map sees it.
 */
function onCard(event: Event): boolean {
  return event
    .composedPath()
    .some(
      (node) => node instanceof Element && node.classList.contains('pin-card'),
    )
}

/**
 * Adds the grey dots (venues without a terrace) and their names, empty until
 * MapView sends them (see dotsUpdate). Clicking a dot or its name selects
 * that venue; clicking the map anywhere else, outside the card, deselects.
 */
export function addDotLayers(
  map: MapLibreMap,
  onSelect: (id: string | null) => void,
) {
  map.addSource(DOTS_SOURCE, {
    type: 'geojson',
    data: dotsData([], null),
  })
  map.addLayer({
    id: DOTS_LAYER,
    type: 'circle',
    source: DOTS_SOURCE,
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        13,
        ['case', ['get', 'selected'], 7, 1.6],
        15.5,
        ['case', ['get', 'selected'], 8, 2.6],
        17,
        ['case', ['get', 'selected'], 10, 5.5],
      ],
      'circle-color': ['case', ['get', 'selected'], '#8A6F55', '#C2A88E'],
      'circle-stroke-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        15.5,
        ['case', ['get', 'selected'], 3, 0.8],
        17,
        ['case', ['get', 'selected'], 3, 1.5],
      ],
      'circle-stroke-color': '#FFFFFF',
    },
  })
  map.addLayer({
    id: LABELS_LAYER,
    type: 'symbol',
    source: DOTS_SOURCE,
    minzoom: LABELS_ZOOM,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-anchor': 'left',
      'text-offset': [0.8, 0],
      'text-max-width': 9,
      'symbol-sort-key': ['case', ['get', 'selected'], 0, 1],
    },
    paint: {
      'text-color': '#6B7280',
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 1.5,
    },
  })
  for (const layer of [DOTS_LAYER, LABELS_LAYER]) {
    map.on('click', layer, (event) => {
      if (onCard(event.originalEvent)) return
      const id: unknown = event.features?.[0]?.properties['id']
      if (typeof id === 'string') onSelect(id)
    })
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
    })
  }
  map.on('click', (event) => {
    if (onCard(event.originalEvent)) return
    const hit = map.queryRenderedFeatures(event.point, {
      layers: [DOTS_LAYER, LABELS_LAYER],
    })
    if (hit.length === 0) onSelect(null)
  })
}

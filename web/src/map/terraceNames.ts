import type {
  FilterSpecification,
  GeoJSONSource,
  Map as MapLibreMap,
} from 'maplibre-gl'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { DOTS_LAYER, LABELS_LAYER } from './dotLayers.ts'

/**
 * Terrace names next to their badges, in the grey dots' style: from zoom
 * 16.5 (fading in from 16.2), sunny badges' names larger and darker and
 * placed first, none on the selected badge (its card names it) or on one
 * showing its price. Invisible boxes the size of each badge (and its price
 * tab) keep every name, the dots' too, off the badges. Far away in a tilted
 * view, names and grey dots are hidden so the background stays clean.
 */

export const NAMES_SOURCE = 'terrace-names'
const NAMES_LAYER = 'terrace-names'
const BADGES_SOURCE = 'terrace-badge-boxes'
const BADGES_LAYER = 'terrace-badge-boxes'
const NAMES_FROM_ZOOM = 16.5

/** A badge and its pointer, and with the price tab to its right, in px. */
const BOX = { width: 38, height: 48 }
const PRICED_BOX = { width: 124, height: 48 }

function blankImage({ width, height }: { width: number; height: number }) {
  return { width, height, data: new Uint8Array(width * height * 4) }
}

/** Full-size badges (some sun now, or soon); the rest are drawn at 78 %. */
const isSunny = (status: VenueStatus) =>
  status.category === 'sun' || status.category === 'soon'

export function addTerraceNameLayers(
  map: MapLibreMap,
  onSelect: (id: string) => void,
): void {
  const empty = { type: 'FeatureCollection' as const, features: [] }
  if (!map.hasImage('badge-box')) map.addImage('badge-box', blankImage(BOX))
  if (!map.hasImage('badge-box-priced'))
    map.addImage('badge-box-priced', blankImage(PRICED_BOX))
  map.addSource(NAMES_SOURCE, { type: 'geojson', data: empty })
  map.addSource(BADGES_SOURCE, { type: 'geojson', data: empty })
  map.addLayer({
    id: NAMES_LAYER,
    type: 'symbol',
    source: NAMES_SOURCE,
    minzoom: NAMES_FROM_ZOOM - 0.3,
    layout: {
      'text-field': ['get', 'name'],
      'text-font': ['Noto Sans Regular'],
      'text-size': ['case', ['get', 'sunny'], 13.5, 11],
      'text-anchor': 'left',
      // Centred on the badge, just right of it: a sunny badge's centre is
      // 19 px above its tip, a grey one (78 %) 13 px (in ems of each size).
      'text-offset': [
        'case',
        ['get', 'sunny'],
        ['literal', [1.62, -1.41]],
        ['literal', [1.64, -1.19]],
      ],
      'text-max-width': 9,
      'symbol-sort-key': ['case', ['get', 'sunny'], 0, 1],
    },
    paint: {
      'text-color': ['case', ['get', 'sunny'], '#1F2328', '#4B5563'],
      'text-halo-color': '#FFFFFF',
      'text-halo-width': 1.5,
      'text-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        NAMES_FROM_ZOOM - 0.3,
        0,
        NAMES_FROM_ZOOM,
        1,
      ],
    },
  })
  // Above the names (so placed first) and invisible: each badge's box.
  map.addLayer({
    id: BADGES_LAYER,
    type: 'symbol',
    source: BADGES_SOURCE,
    minzoom: NAMES_FROM_ZOOM - 0.3,
    layout: {
      'icon-image': [
        'case',
        ['get', 'priced'],
        'badge-box-priced',
        'badge-box',
      ],
      'icon-anchor': ['case', ['get', 'priced'], 'bottom-left', 'bottom'],
      'icon-offset': [
        'case',
        ['get', 'priced'],
        ['literal', [-20, 0]],
        ['literal', [0, 0]],
      ],
      'icon-size': ['case', ['get', 'sunny'], 1, 0.78],
      'icon-allow-overlap': true,
      // No padding: a name starts 3 px right of its own badge's box.
      'icon-padding': 0,
    },
  })
  map.on('click', NAMES_LAYER, (event) => {
    const id: unknown = event.features?.[0]?.properties['id']
    if (typeof id === 'string') onSelect(id)
  })
  map.on('mouseenter', NAMES_LAYER, () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', NAMES_LAYER, () => {
    map.getCanvas().style.cursor = ''
  })
}

type NameProps = {
  id: string
  name: string
  sunny: boolean
  priced: boolean
  named: boolean
}

/** The names and badge boxes for the terraces shown as badges. */
export function terraceNamesData(
  statuses: readonly VenueStatus[],
  selectedId: string | null,
  priced: ReadonlySet<string>,
) {
  const features = statuses
    .filter((s) => s.hasTerrace && s.venue.id !== selectedId)
    .map((s) => {
      const at = s.venue.terrace ?? s.venue.venue
      const props: NameProps = {
        id: s.venue.id,
        name: s.venue.name,
        sunny: isSunny(s),
        priced: priced.has(s.venue.id),
        // A badge showing its price keeps the space for it.
        named: !priced.has(s.venue.id),
      }
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [at.lon, at.lat] },
        properties: props,
      }
    })
  return { type: 'FeatureCollection' as const, features }
}

/**
 * The share of the screen, from the top, that is "far away" at this tilt:
 * none looking straight down, up to 40 % when tilted to 60° or more.
 */
export function farShare(pitch: number): number {
  return Math.min(0.4, Math.max(0, ((pitch - 30) / 30) * 0.35))
}

/** What was last sent to each map, so unchanged updates send nothing. */
const sent = new WeakMap<
  MapLibreMap,
  { names: string; boxes: string; dots: string }
>()

/**
 * Sends the names, then hides names and grey dots in the far background.
 * Runs on every slider step and after every move, so it only touches the map
 * when something changed: MapLibre re-tiles a source on every setData.
 */
export function updateTerraceNames(
  map: MapLibreMap,
  data: ReturnType<typeof terraceNamesData>,
  dots: readonly { id: string; lon: number; lat: number }[],
): void {
  const names = map.getSource<GeoJSONSource>(NAMES_SOURCE)
  const badges = map.getSource<GeoJSONSource>(BADGES_SOURCE)
  if (!names || !badges) return
  const cut = map.getCanvas().clientHeight * farShare(map.getPitch())
  const far = (lon: number, lat: number) =>
    cut > 0 && map.project([lon, lat]).y < cut
  const last = sent.get(map) ?? { names: '', boxes: '', dots: '' }
  const shown = data.features.filter((f) => {
    const [lon = 0, lat = 0] = f.geometry.coordinates
    return f.properties.named && !far(lon, lat)
  })
  const namesKey = shown
    .map((f) => `${f.properties.id}${f.properties.sunny ? '*' : ''}`)
    .join(',')
  if (namesKey !== last.names) void names.setData({ ...data, features: shown })
  const boxesKey = data.features
    .map(
      (f) =>
        `${f.properties.id}${f.properties.sunny ? '*' : ''}${f.properties.priced ? '€' : ''}`,
    )
    .join(',')
  if (boxesKey !== last.boxes) void badges.setData(data)
  const farDots = dots.filter((d) => far(d.lon, d.lat)).map((d) => d.id)
  const dotsKey = farDots.join(',')
  sent.set(map, { names: namesKey, boxes: boxesKey, dots: dotsKey })
  if (dotsKey === last.dots) return
  const keep: FilterSpecification | null =
    farDots.length > 0
      ? ['!', ['in', ['get', 'id'], ['literal', farDots]]]
      : null
  for (const layer of [DOTS_LAYER, LABELS_LAYER])
    if (map.getLayer(layer)) map.setFilter(layer, keep)
}

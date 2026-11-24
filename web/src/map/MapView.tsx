import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import './maplibre.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BASEMAP_STYLE_URL } from '../config.ts'
import type { LatLon } from '../data/terraces.ts'
import type { SunPosition } from '../sun/sunState.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'
import {
  cardFolded,
  cardScale,
  pitchForZoom,
  SHADOW_OPACITY,
} from './camera.ts'
import { dotsData, dotsUpdate } from './dots.ts'
import { highlightedIds, OVERVIEW_ZOOM } from './highlights.ts'
import { MapControls } from './MapControls.tsx'
import { createNightSwitch, nightDepth } from './night.ts'
import { PinCard } from './PinCard.tsx'
import { parseBasemapStyle, sunLight, sunlitStyle } from './mapStyle.ts'
import { createPin, updatePin } from './pins.ts'
import { shadowCollection } from './shadowLayer.ts'

// MapLibre looks for its worker next to its own module, which bundling breaks.
// Let Vite bundle the worker and tell MapLibre where it ended up.
setWorkerUrl(workerUrl)

const SHADOWS = 'building-shadows'
const DOTS_SOURCE = 'venues-unconfirmed'
const DOTS_LAYER = 'venues-unconfirmed'
const LABELS_LAYER = 'venues-unconfirmed-labels'
/** From this zoom, unconfirmed venues show their name next to the dot. */
const LABELS_ZOOM = 16.5

/** City overview in the top view: the old town, the river and the south-west districts. */
const INITIAL_ZOOM = 13.8
const INITIAL_VIEW = {
  center: [-6.978, 38.8725] as [number, number],
  zoom: INITIAL_ZOOM,
  pitch: pitchForZoom(INITIAL_ZOOM),
  bearing: 0,
}

const MAP_LOCALE = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
  'AttributionControl.MapFeedback': 'Comentarios sobre el mapa',
  'Map.Title': 'Mapa',
}

/** Close enough to place a venue within a few metres (the report picker). */
const PICK_ZOOM = 18

/** Size the venue card for a zoom (see cardScale). */
function sizeCard(el: HTMLElement, zoom: number) {
  el.style.setProperty('--card-scale', String(cardScale(zoom)))
}

const FIT_MARGIN = 16
const FIT_GAP = 8

/**
 * Pan so the open card sits fully inside the map and clear of the floating
 * controls (city, buttons, legend). If it is taller than the free space, cap
 * its height (`--card-max`) so the card body scrolls instead.
 */
function fitCard(map: MapLibreMap, card: HTMLElement, wrap: HTMLElement) {
  const box = wrap.getBoundingClientRect()
  const cardRect = card.querySelector('.pin-card')?.getBoundingClientRect()
  if (!cardRect || cardRect.width === 0) return
  let top = box.top + FIT_MARGIN
  let bottom = box.bottom - FIT_MARGIN
  for (const el of wrap.querySelectorAll(
    '.map-city, .map-buttons, .map-legend',
  )) {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.right <= cardRect.left || r.left >= cardRect.right)
      continue
    if (r.top + r.height / 2 < box.top + box.height / 2)
      top = Math.max(top, r.bottom + FIT_GAP)
    else bottom = Math.min(bottom, r.top - FIT_GAP)
  }
  const scale = Number(card.style.getPropertyValue('--card-scale')) || 1
  card.style.setProperty('--card-max', `${(bottom - top) / scale}px`)
  const fresh =
    card.querySelector('.pin-card')?.getBoundingClientRect() ?? cardRect
  const left = box.left + FIT_MARGIN
  const right = box.right - FIT_MARGIN
  const dx =
    fresh.left < left
      ? fresh.left - left
      : fresh.right > right
        ? fresh.right - right
        : 0
  const dy =
    fresh.top < top || fresh.height > bottom - top
      ? fresh.top - top
      : fresh.bottom > bottom
        ? fresh.bottom - bottom
        : 0
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
    map.panBy([dx, dy], { duration: 300 })
}

/** Bring a venue into view, close enough for its full card. */
function focusVenue(map: MapLibreMap, status: VenueStatus) {
  const position = status.venue.terrace ?? status.venue.venue
  const zoom = Math.max(map.getZoom(), 16.5)
  map.easeTo({
    center: [position.lon, position.lat],
    zoom,
    pitch: pitchForZoom(zoom),
    // Venue a bit above centre, so the card below its badge fits in view.
    offset: [0, -120],
    duration: 900,
  })
}

type Props = {
  statuses: readonly VenueStatus[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  sun: SunPosition
  /** Chosen minute of the day, for the sun left in the selected venue's card. */
  minutes: number
  /** Today's sunset, for the card's sun bar. */
  sunset: number | null
  attribution: readonly string[]
  /** The data has leaf-off horizons (ADR-0007). */
  leafOffTrees?: boolean
  /** While set, gets the map's centre now and as the map moves (the report picker). */
  onCenterChange?: (center: LatLon) => void
  /** Centres the map here, zoomed in to place a point (the report picker). */
  flyTo?: LatLon | null
}

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

type PinEntry = { marker: Marker; el: HTMLButtonElement }

export function MapView({
  statuses,
  selectedId,
  onSelect,
  sun,
  minutes,
  sunset,
  attribution,
  leafOffTrees = false,
  onCenterChange,
  flyTo = null,
}: Props) {
  // The selected badge opens into a card below it, as its own marker.
  const cardEl = useMemo(() => {
    const el = document.createElement('div')
    el.className = 'pin-card-marker'
    return el
  }, [])
  const cardMarkerRef = useRef<Marker | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const attributionSlotRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const pinsRef = useRef(new Map<string, PinEntry>())
  /** What the dots source holds now (see dotsUpdate). */
  const dotsKeyRef = useRef<string | null>(null)
  const onSelectRef = useRef(onSelect)
  const onCenterChangeRef = useRef(onCenterChange)
  const sunRef = useRef(sun)
  const nightSwitchRef = useRef<((depth: number | null) => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [overview, setOverview] = useState(INITIAL_ZOOM < OVERVIEW_ZOOM)
  const [folded, setFolded] = useState(cardFolded(INITIAL_ZOOM))
  const depth = nightDepth(sun.altitude)
  const night = depth !== null
  const highlighted = useMemo(() => highlightedIds(statuses), [statuses])

  const selectedIdRef = useRef(selectedId)
  const statusesRef = useRef(statuses)

  useEffect(() => {
    onSelectRef.current = onSelect
    onCenterChangeRef.current = onCenterChange
    selectedIdRef.current = selectedId
    statusesRef.current = statuses
  }, [onSelect, onCenterChange, selectedId, statuses])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let map: MapLibreMap | null = null
    let attributionControl: AttributionControl | null = null
    let cancelled = false
    const pins = pinsRef.current

    fetch(BASEMAP_STYLE_URL)
      .then(async (response) => {
        if (!response.ok)
          throw new Error(`basemap style: HTTP ${response.status}`)
        return parseBasemapStyle(await response.json())
      })
      .then((base) => {
        if (cancelled) return
        map = new MapLibreMap({
          container,
          style: sunlitStyle(base),
          ...INITIAL_VIEW,
          maxPitch: 70,
          // Badajoz only: no panning off to the rest of the world.
          maxBounds: [
            [-7.07, 38.82],
            [-6.89, 38.94],
          ],
          minZoom: 12,
          // The tilt follows the zoom (see camera.ts), so no manual pitching.
          pitchWithRotate: false,
          // Smooth building edges in the 3D view.
          canvasContextAttributes: { antialias: true },
          locale: MAP_LOCALE,
          attributionControl: false,
        })
        sizeCard(cardEl, map.getZoom())
        // The attribution sits in our own layout, next to the legend
        // (MapControls), rather than in a corner of the map.
        const slot = attributionSlotRef.current
        if (slot) {
          attributionControl = new AttributionControl({ compact: true })
          slot.replaceChildren(attributionControl.onAdd(map))
          // MapLibre opens the compact attribution when its text first
          // arrives and only closes it on a drag: start with just the "i".
          const collapse = () =>
            slot
              .querySelector('.maplibregl-ctrl-attrib')
              ?.classList.remove('maplibregl-compact-show')
          map.once('load', collapse)
          map.once('idle', collapse)
        }
        map.touchPitch.disable()
        map.on('move', () => {
          if (!map) return
          const { lat, lng } = map.getCenter()
          onCenterChangeRef.current?.({ lat, lon: lng })
        })
        map.on('zoom', (event) => {
          if (!map) return
          setOverview(map.getZoom() < OVERVIEW_ZOOM)
          const zoom = map.getZoom()
          setFolded(cardFolded(zoom))
          // Every frame of a pinch: size and fade the card straight from the
          // zoom, without waiting for React.
          sizeCard(cardEl, zoom)
          // Follow user gestures live; camera animations pass their own pitch.
          if (event.originalEvent) map.setPitch(pitchForZoom(map.getZoom()))
        })
        map.on('zoomend', () => {
          if (!map) return
          const pitch = pitchForZoom(map.getZoom())
          if (Math.abs(map.getPitch() - pitch) > 0.5)
            map.easeTo({ pitch, duration: 300 })
        })
        map.on('load', () => {
          if (!map) return
          // Ground shadows of the buildings, under the 3D extrusions.
          map.addSource(SHADOWS, {
            type: 'geojson',
            data: shadowCollection(map, sunRef.current),
          })
          map.addLayer(
            {
              id: SHADOWS,
              // A paper-thin extrusion rather than a fill: MapLibre draws an
              // extrusion layer in one pass and fades the layer as a whole,
              // so where shadows overlap (neighbouring buildings, the same
              // building twice at a tile edge) they don't stack darker.
              type: 'fill-extrusion',
              source: SHADOWS,
              minzoom: 14,
              paint: {
                'fill-extrusion-color': '#6B5848',
                'fill-extrusion-opacity': SHADOW_OPACITY,
                'fill-extrusion-height': 0.05,
                'fill-extrusion-vertical-gradient': false,
              },
            },
            map.getLayer('building') ? 'building' : undefined,
          )
          const refreshShadows = () => {
            if (map)
              void map
                .getSource<GeoJSONSource>(SHADOWS)
                ?.setData(shadowCollection(map, sunRef.current))
          }
          map.on('moveend', refreshShadows)
          map.once('idle', refreshShadows)
          map.on('sourcedata', (event) => {
            if (event.sourceId === 'openmaptiles' && event.isSourceLoaded)
              refreshShadows()
          })
          map.addSource(DOTS_SOURCE, {
            type: 'geojson',
            data: dotsData([], null),
          })
          dotsKeyRef.current = null
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
              'circle-color': [
                'case',
                ['get', 'selected'],
                '#8A6F55',
                '#C2A88E',
              ],
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
              if (typeof id === 'string') onSelectRef.current(id)
            })
            map.on('mouseenter', layer, () => {
              if (map) map.getCanvas().style.cursor = 'pointer'
            })
            map.on('mouseleave', layer, () => {
              if (map) map.getCanvas().style.cursor = ''
            })
          }
          map.on('click', (event) => {
            if (!map) return
            if (onCard(event.originalEvent)) return
            const hit = map.queryRenderedFeatures(event.point, {
              layers: [DOTS_LAYER, LABELS_LAYER],
            })
            if (hit.length === 0) onSelectRef.current(null)
          })
          nightSwitchRef.current = createNightSwitch(map, new Set([SHADOWS]))
          mapRef.current = map
          // Dev-only handle for debugging and visual checks from the console.
          if (import.meta.env.DEV) {
            ;(window as unknown as { __map?: MapLibreMap }).__map = map
          }
          setReady(true)
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
      nightSwitchRef.current = null
      for (const { marker } of pins.values()) marker.remove()
      pins.clear()
      mapRef.current = null
      attributionControl?.onRemove()
      map?.remove()
    }
  }, [cardEl])

  // The report picker: its first centre, then flying to the venue to move.
  const tracking = onCenterChange !== undefined
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !tracking) return
    const { lat, lng } = map.getCenter()
    onCenterChangeRef.current?.({ lat, lon: lng })
  }, [ready, tracking])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !flyTo) return
    map.easeTo({
      center: [flyTo.lon, flyTo.lat],
      zoom: PICK_ZOOM,
      pitch: pitchForZoom(PICK_ZOOM),
      duration: 900,
    })
  }, [ready, flyTo])

  // Light the buildings from the sun's real position and cast their shadows.
  useEffect(() => {
    sunRef.current = sun
    const map = mapRef.current
    if (!ready || !map) return
    map.setLight(sunLight(sun))
    void map
      .getSource<GeoJSONSource>(SHADOWS)
      ?.setData(shadowCollection(map, sun))
  }, [ready, sun])

  // A dark map at night.
  useEffect(() => {
    if (ready) nightSwitchRef.current?.(depth)
  }, [ready, depth])

  // Grey dots for venues without a terrace, sent only when they change (not
  // on every step of the time slider).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const update = dotsUpdate(dotsKeyRef.current, statuses, selectedId)
    if (!update) return
    const source = map.getSource<GeoJSONSource>(DOTS_SOURCE)
    if (!source) return
    void source.setData(update.data)
    dotsKeyRef.current = update.key
  }, [ready, statuses, selectedId])

  // Pins for terraces.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return

    const pins = pinsRef.current
    const wanted = new Map(
      statuses.filter((s) => s.hasTerrace).map((s) => [s.venue.id, s]),
    )
    for (const [id, entry] of pins) {
      if (!wanted.has(id)) {
        entry.marker.remove()
        pins.delete(id)
      }
    }
    for (const [id, status] of wanted) {
      let entry = pins.get(id)
      if (!entry) {
        const el = createPin(() => {
          // Tapping the selected badge (folded in the overview) zooms back
          // in to open its card.
          const current = statusesRef.current.find((s) => s.venue.id === id)
          if (id === selectedIdRef.current && current) focusVenue(map, current)
          else onSelectRef.current(id)
        })
        const position = status.venue.terrace ?? status.venue.venue
        const marker = new Marker({ element: el, anchor: 'bottom' })
          .setLngLat([position.lon, position.lat])
          .addTo(map)
        entry = { marker, el }
        pins.set(id, entry)
      }
      updatePin(entry.el, status, id === selectedId)
      const top = highlighted.has(id)
      entry.el.classList.toggle('pin-marker--top', top)
      entry.el.style.zIndex =
        id === selectedId
          ? '4'
          : top
            ? '3'
            : status.category === 'sun' || status.category === 'soon'
              ? '2'
              : '1'
    }
  }, [ready, statuses, selectedId, highlighted])

  const selectedStatus = statuses.find((s) => s.venue.id === selectedId) ?? null

  // Place the card so its badge tab sits exactly on the selected badge (or dot).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !selectedStatus) {
      cardMarkerRef.current?.remove()
      cardMarkerRef.current = null
      return
    }
    const position = selectedStatus.venue.terrace ?? selectedStatus.venue.venue
    // The tab's badge centre is 41 px below the card's top; a terrace badge
    // centre is 27 px above its point, a dot is centred on it.
    const offset: [number, number] = [0, selectedStatus.hasTerrace ? -68 : -41]
    if (!cardMarkerRef.current) {
      cardMarkerRef.current = new Marker({
        element: cardEl,
        anchor: 'top',
        offset,
      })
        .setLngLat([position.lon, position.lat])
        .addTo(map)
    } else {
      cardMarkerRef.current
        .setOffset(offset)
        .setLngLat([position.lon, position.lat])
    }
  }, [ready, selectedStatus, cardEl])

  // Bring the selected venue into view when the selection changes. A venue
  // from a shared link may be selected before the data arrives: wait for it.
  const lastSelected = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || selectedId === lastSelected.current) return
    const status = statuses.find((s) => s.venue.id === selectedId)
    if (selectedId !== null && !status) return
    lastSelected.current = selectedId
    if (!status) return
    focusVenue(map, status)
    // Once there, make sure the whole card is visible and usable.
    map.once('moveend', () => {
      const wrap = containerRef.current?.parentElement
      if (wrap) fitCard(map, cardEl, wrap)
    })
  }, [ready, selectedId, statuses, cardEl])

  // Keep the card in view when it grows (price form, longer names).
  useEffect(() => {
    const map = mapRef.current
    const wrap = containerRef.current?.parentElement
    if (!ready || !map || !wrap || !selectedId) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!map.isMoving()) fitCard(map, cardEl, wrap)
      })
    })
    const card = cardEl.querySelector('.pin-card')
    if (card) observer.observe(card)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ready, selectedId, cardEl])

  return (
    <div
      className={`map-wrap${overview ? ' is-overview' : ''}${night ? ' is-night' : ''}${folded ? ' is-card-folded' : ''}${selectedStatus && !folded ? ' has-card' : ''}`}
    >
      <div
        ref={containerRef}
        className="terrace-map"
        role="region"
        aria-label="Mapa de terrazas de Badajoz"
      />
      {failed && (
        <p className="map-error" role="alert">
          No se ha podido cargar el mapa.
        </p>
      )}
      <MapControls
        mapRef={mapRef}
        ready={ready}
        attribution={attribution}
        leafOffTrees={leafOffTrees}
        attributionSlot={attributionSlotRef}
      />
      {selectedStatus &&
        createPortal(
          <PinCard status={selectedStatus} minutes={minutes} sunset={sunset} />,
          cardEl,
        )}
    </div>
  )
}

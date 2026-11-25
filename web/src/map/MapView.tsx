import {
  Map as MapLibreMap,
  Marker,
  prewarm,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import './maplibre.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BASEMAP_STYLE_URL } from '../config.ts'
import type { LatLon } from '../data/terraces.ts'
import type { SunPosition } from '../sun/sunState.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'
import {
  cardFolded,
  pitchForZoom,
  RELIEF_ZOOM,
  SHADOW_OPACITY,
} from './camera.ts'
import { fitCard, focusVenue, sizeCard } from './cardFit.ts'
import { addDotLayers, DOTS_SOURCE } from './dotLayers.ts'
import { dotsUpdate } from './dots.ts'
import { highlightedIds, OVERVIEW_ZOOM } from './highlights.ts'
import { MapControls } from './MapControls.tsx'
import { createNightSwitch, nightDepth } from './night.ts'
import { PinCard } from './PinCard.tsx'
import { INITIAL_ZOOM, MAP_OPTIONS } from './mapOptions.ts'
import { parseBasemapStyle, sunLight, sunlitStyle } from './mapStyle.ts'
import { createPin, updatePin } from './pins.ts'
import { ShadowCache } from './shadowLayer.ts'

// MapLibre looks for its worker next to its own module, which bundling breaks.
// Let Vite bundle the worker and tell MapLibre where it ended up.
setWorkerUrl(workerUrl)
// Start the worker now, so its download and compile overlap the basemap style
// fetch instead of waiting for the Map to be constructed. The worker then
// stays for the page's lifetime, which the app (one map) wants anyway.
prewarm()

const SHADOWS = 'building-shadows'

/** Close enough to place a venue within a few metres (the report picker). */
const PICK_ZOOM = 18

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

/** How long the card takes to shrink back into its badge (see .is-closing). */
const CARD_CLOSE_MS = 220

/** How often the shadows are recast at most while the map moves. */
const SHADOW_THROTTLE_MS = 120

/** Shows the building shadows when new buildings or a new sun changed them. */
function castShadows(map: MapLibreMap, sun: SunPosition, cache: ShadowCache) {
  const change = cache.update(map, sun)
  const source = map.getSource<GeoJSONSource>(SHADOWS)
  if (!change || !source) return
  if ('data' in change) void source.setData(change.data)
  // Only the new streets: re-sending every shadow stutters as they add up.
  else void source.updateData(change)
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
  const mapRef = useRef<MapLibreMap | null>(null)
  const pinsRef = useRef(new Map<string, PinEntry>())
  /** What the dots source holds now (see dotsUpdate). */
  const dotsKeyRef = useRef<string | null>(null)
  /** The buildings seen so far and their shadows (see ShadowCache). */
  const shadowCacheRef = useRef(new ShadowCache())
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
          ...MAP_OPTIONS,
          // The basemap credits live in the legend's info panel (MapControls).
          attributionControl: false,
        })
        sizeCard(cardEl, map.getZoom())
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
            data: { type: 'FeatureCollection', features: [] },
          })
          shadowCacheRef.current = new ShadowCache()
          map.addLayer(
            {
              id: SHADOWS,
              // A paper-thin extrusion rather than a fill: MapLibre draws an
              // extrusion layer in one pass and fades the layer as a whole,
              // so where shadows overlap (neighbouring buildings, the same
              // building twice at a tile edge) they don't stack darker.
              type: 'fill-extrusion',
              source: SHADOWS,
              minzoom: RELIEF_ZOOM,
              paint: {
                'fill-extrusion-color': '#6B5848',
                'fill-extrusion-opacity': SHADOW_OPACITY,
                'fill-extrusion-height': 0.05,
                'fill-extrusion-vertical-gradient': false,
              },
            },
            map.getLayer('building') ? 'building' : undefined,
          )
          // Check as the map moves (at most every SHADOW_THROTTLE_MS), as
          // building tiles arrive and when it settles, so shadows keep up
          // with zooms, pans and flights. Most checks redo nothing (see
          // ShadowCache): only buildings new to it or a new sun are cast.
          let shadowTimer: ReturnType<typeof setTimeout> | null = null
          const refreshShadows = () => {
            if (shadowTimer) clearTimeout(shadowTimer)
            shadowTimer = null
            if (map) castShadows(map, sunRef.current, shadowCacheRef.current)
          }
          const scheduleShadows = () => {
            shadowTimer ??= setTimeout(refreshShadows, SHADOW_THROTTLE_MS)
          }
          map.on('move', scheduleShadows)
          map.on('moveend', refreshShadows)
          map.on('sourcedata', (event) => {
            if (event.sourceId === 'openmaptiles' && event.tile)
              scheduleShadows()
          })
          map.on('idle', refreshShadows)
          addDotLayers(map, (id) => onSelectRef.current(id))
          dotsKeyRef.current = null
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
    castShadows(map, sun, shadowCacheRef.current)
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

  // The last card shown stays a moment after deselecting, to shrink back
  // into its badge.
  const [lastCard, setLastCard] = useState<VenueStatus | null>(null)
  if (selectedStatus && selectedStatus !== lastCard) setLastCard(selectedStatus)
  const cardStatus = selectedStatus ?? lastCard
  const closing = !selectedStatus && lastCard !== null

  useLayoutEffect(() => {
    cardEl.classList.toggle('is-closing', closing)
    if (!closing) return
    const timer = setTimeout(() => setLastCard(null), CARD_CLOSE_MS)
    return () => clearTimeout(timer)
  }, [closing, cardEl])

  // Place the card so its badge tab sits exactly on the selected badge (or dot).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !cardStatus) {
      cardMarkerRef.current?.remove()
      cardMarkerRef.current = null
      return
    }
    const position = cardStatus.venue.terrace ?? cardStatus.venue.venue
    // The tab's badge centre is 41 px below the card's top; a terrace badge
    // centre is 27 px above its point, a dot is centred on it.
    const offset: [number, number] = [0, cardStatus.hasTerrace ? -68 : -41]
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
  }, [ready, cardStatus, cardEl])

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
      />
      {cardStatus &&
        createPortal(
          <PinCard
            key={cardStatus.venue.id}
            status={cardStatus}
            minutes={minutes}
            sunset={sunset}
          />,
          cardEl,
        )}
    </div>
  )
}

import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type GeoJSONSource,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import { BASEMAP_STYLE_URL } from '../config.ts'
import type { SunPosition } from '../sun/sunState.ts'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { MapControls } from './MapControls.tsx'
import { sunLight, sunlitStyle } from './mapStyle.ts'
import { createPin, updatePin } from './pins.ts'
import { demoValues, formatPrice } from '../demo/demo.ts'
import { shadowCollection } from './shadowLayer.ts'

// MapLibre looks for its worker next to its own module, which bundling breaks.
// Let Vite bundle the worker and tell MapLibre where it ended up.
setWorkerUrl(workerUrl)

const SHADOWS = 'building-shadows'
const DOTS_SOURCE = 'venues-unconfirmed'
const DOTS_LAYER = 'venues-unconfirmed'
const LABELS_LAYER = 'venues-unconfirmed-labels'
/** From this zoom, unconfirmed venues show their (demo) price instead of a dot. */
const LABELS_ZOOM = 16.5

/** Old town, tilted like the design: Plaza de España in front, river behind. */
const INITIAL_VIEW = {
  center: [-6.9712, 38.8792] as [number, number],
  zoom: 15.9,
  pitch: 55,
  bearing: -18,
}

const MAP_LOCALE = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
  'AttributionControl.MapFeedback': 'Comentarios sobre el mapa',
  'Map.Title': 'Mapa',
}

type Props = {
  statuses: readonly VenueStatus[]
  selectedId: string | null
  onSelect: (id: string | null) => void
  sun: SunPosition
  attribution: readonly string[]
}

type PinEntry = { marker: Marker; el: HTMLButtonElement }

function dotsData(statuses: readonly VenueStatus[], selectedId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: statuses
      .filter((s) => !s.hasTerrace)
      .map((s) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [s.venue.venue.lon, s.venue.venue.lat],
        },
        properties: {
          id: s.venue.id,
          selected: s.venue.id === selectedId,
          price: formatPrice(demoValues(s.venue.id).priceCents),
        },
      })),
  }
}

/** A white rounded pill, stretched by MapLibre around each price label. */
function pricePill(): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return new ImageData(48, 32)
  ctx.fillStyle = '#FFFFFF'
  ctx.strokeStyle = '#D9DCE1'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(1, 1, 46, 30, 15)
  ctx.fill()
  ctx.stroke()
  return ctx.getImageData(0, 0, 48, 32)
}

export function MapView({
  statuses,
  selectedId,
  onSelect,
  sun,
  attribution,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const pinsRef = useRef(new Map<string, PinEntry>())
  const onSelectRef = useRef(onSelect)
  const sunRef = useRef(sun)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    onSelectRef.current = onSelect
  }, [onSelect])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let map: MapLibreMap | null = null
    let cancelled = false
    const pins = pinsRef.current

    fetch(BASEMAP_STYLE_URL)
      .then((response) => response.json() as Promise<StyleSpecification>)
      .then((base) => {
        if (cancelled) return
        map = new MapLibreMap({
          container,
          style: sunlitStyle(base),
          ...INITIAL_VIEW,
          maxPitch: 70,
          locale: MAP_LOCALE,
          attributionControl: false,
        })
        map.addControl(new AttributionControl({ compact: true }), 'bottom-left')
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
              type: 'fill',
              source: SHADOWS,
              minzoom: 14,
              paint: {
                'fill-color': '#3F4560',
                'fill-opacity': 0.22,
                'fill-antialias': false,
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
                ['case', ['get', 'selected'], 7, 2.5],
                17,
                ['case', ['get', 'selected'], 10, 5.5],
              ],
              'circle-color': [
                'case',
                ['get', 'selected'],
                '#6B7280',
                '#A3A9B3',
              ],
              'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
              'circle-stroke-color': '#FFFFFF',
              // Fade to price labels when zoomed in (the selected dot stays).
              'circle-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                LABELS_ZOOM - 0.3,
                1,
                LABELS_ZOOM,
                ['case', ['get', 'selected'], 1, 0],
              ],
              'circle-stroke-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                LABELS_ZOOM - 0.3,
                1,
                LABELS_ZOOM,
                ['case', ['get', 'selected'], 1, 0],
              ],
            },
          })
          map.addImage('price-pill', pricePill(), {
            pixelRatio: 2,
            stretchX: [[16, 32]],
            stretchY: [[15, 17]],
            content: [12, 6, 36, 26],
          })
          map.addLayer({
            id: LABELS_LAYER,
            type: 'symbol',
            source: DOTS_SOURCE,
            minzoom: LABELS_ZOOM,
            layout: {
              'text-field': ['get', 'price'],
              'text-font': ['Noto Sans Bold'],
              'text-size': 12,
              'icon-image': 'price-pill',
              'icon-text-fit': 'both',
              'icon-text-fit-padding': [3, 8, 3, 8],
              'symbol-sort-key': ['case', ['get', 'selected'], 0, 1],
            },
            paint: { 'text-color': '#6B7280' },
          })
          for (const layer of [DOTS_LAYER, LABELS_LAYER]) {
            map.on('click', layer, (event) => {
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
            const hit = map.queryRenderedFeatures(event.point, {
              layers: [DOTS_LAYER, LABELS_LAYER],
            })
            if (hit.length === 0) onSelectRef.current(null)
          })
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
      for (const { marker } of pins.values()) marker.remove()
      pins.clear()
      mapRef.current = null
      map?.remove()
    }
  }, [])

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

  // Price pins for terraces (and the selected venue), grey dots for the rest.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    void map
      .getSource<GeoJSONSource>(DOTS_SOURCE)
      ?.setData(dotsData(statuses, selectedId))

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
        const el = createPin(() => onSelectRef.current(id))
        const position = status.venue.terrace ?? status.venue.venue
        const marker = new Marker({ element: el, anchor: 'bottom' })
          .setLngLat([position.lon, position.lat])
          .addTo(map)
        entry = { marker, el }
        pins.set(id, entry)
      }
      updatePin(entry.el, status, id === selectedId)
      entry.el.style.zIndex =
        id === selectedId ? '3' : status.category === 'sun' ? '2' : '1'
    }
  }, [ready, statuses, selectedId])

  // Bring the selected venue into view when the selection changes.
  const lastSelected = useRef<string | null>(null)
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || selectedId === lastSelected.current) return
    lastSelected.current = selectedId
    const status = statuses.find((s) => s.venue.id === selectedId)
    if (!status) return
    const position = status.venue.terrace ?? status.venue.venue
    map.easeTo({
      center: [position.lon, position.lat],
      zoom: Math.max(map.getZoom(), 16.5),
      duration: 900,
    })
  }, [ready, selectedId, statuses])

  return (
    <div className="map-wrap">
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
      <MapControls mapRef={mapRef} ready={ready} attribution={attribution} />
    </div>
  )
}

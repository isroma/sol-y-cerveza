import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type FillLayerSpecification,
  type GeoJSONSource,
  type LayerSpecification,
  type StyleSpecification,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef, useState } from 'react'
import { BADAJOZ_CENTER, BASEMAP_STYLE_URL } from '../config.ts'
import type { LatLon } from '../data/terraces.ts'
import { sunlitStyle } from '../map/mapStyle.ts'
import { STATE_COLORS, type MapVenue } from './mapState.ts'

setWorkerUrl(workerUrl)

type Props = {
  venues: readonly MapVenue[]
  selected: MapVenue | null
  /** Where the selected venue's tables are, if known. */
  terrace: LatLon | null
  /** Terrace pin mode: the next click places the pin, which can be dragged meanwhile. */
  pinning: boolean
  onSelect: (id: string | null) => void
  /** A click on the map away from any venue dot. */
  onMapClick: (at: LatLon) => void
  onPinTerrace: (at: LatLon) => void
  onMoveVenue: (at: LatLon) => void
}

const SOURCE = 'venues'
const DOTS = 'venues-dots'
const LABELS = 'venues-labels'

/** The app's palette, always flat: buildings as outlined footprints, so pins land where clicked. */
function flatStyle(base: StyleSpecification): StyleSpecification {
  const style = sunlitStyle(base)
  const layers = style.layers.map((layer): LayerSpecification => {
    if (layer.type !== 'fill-extrusion') return layer
    const footprints: FillLayerSpecification = {
      id: layer.id,
      type: 'fill',
      source: layer.source,
      paint: { 'fill-color': '#EADBC5', 'fill-outline-color': '#CDB89A' },
    }
    if (layer['source-layer'])
      footprints['source-layer'] = layer['source-layer']
    if (layer.filter) footprints.filter = layer.filter
    if (layer.minzoom !== undefined) footprints.minzoom = layer.minzoom
    return footprints
  })
  return { ...style, layers }
}

function collection(venues: readonly MapVenue[], selectedId: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: venues
      .filter((v) => v.id !== selectedId)
      .map((v) => ({
        type: 'Feature' as const,
        geometry: {
          type: 'Point' as const,
          coordinates: [v.at.lon, v.at.lat],
        },
        properties: { id: v.id, name: v.name, state: v.state },
      })),
  }
}

function pinElement(className: string, label: string): HTMLDivElement {
  const el = document.createElement('div')
  el.className = className
  el.title = label
  return el
}

export function AdminMap({
  venues,
  selected,
  terrace,
  pinning,
  onSelect,
  onMapClick,
  onPinTerrace,
  onMoveVenue,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const venueMarker = useRef<Marker | null>(null)
  const terraceMarker = useRef<Marker | null>(null)
  const callbacks = useRef({
    onSelect,
    onMapClick,
    onPinTerrace,
    onMoveVenue,
    selected,
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    callbacks.current = {
      onSelect,
      onMapClick,
      onPinTerrace,
      onMoveVenue,
      selected,
    }
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let cancelled = false
    let map: MapLibreMap | null = null
    void fetch(BASEMAP_STYLE_URL)
      .then((response) => response.json() as Promise<StyleSpecification>)
      .then((base) => {
        if (cancelled) return
        const m = new MapLibreMap({
          container,
          style: flatStyle(base),
          center: BADAJOZ_CENTER,
          zoom: 15,
          minZoom: 12,
          maxZoom: 21,
          pitch: 0,
          maxPitch: 0,
          bearing: 0,
          dragRotate: false,
          pitchWithRotate: false,
          maxBounds: [
            [-7.07, 38.82],
            [-6.89, 38.94],
          ],
        })
        map = m
        m.touchZoomRotate.disableRotation()
        m.keyboard.disableRotation()
        m.on('load', () => {
          m.addSource(SOURCE, {
            type: 'geojson',
            data: collection([], null),
          })
          m.addLayer({
            id: DOTS,
            type: 'circle',
            source: SOURCE,
            paint: {
              'circle-radius': [
                'interpolate',
                ['linear'],
                ['zoom'],
                13,
                3,
                18,
                7,
              ],
              'circle-color': [
                'match',
                ['get', 'state'],
                'terrace',
                STATE_COLORS.terrace,
                'data_terrace',
                STATE_COLORS.data_terrace,
                'no_terrace',
                STATE_COLORS.no_terrace,
                'not_venue',
                STATE_COLORS.not_venue,
                STATE_COLORS.unknown,
              ],
              'circle-stroke-color': '#3B3228',
              'circle-stroke-width': 1.2,
            },
          })
          m.addLayer({
            id: LABELS,
            type: 'symbol',
            source: SOURCE,
            minzoom: 16.5,
            layout: {
              'text-field': ['get', 'name'],
              'text-size': 12,
              'text-offset': [0, 1.1],
              'text-anchor': 'top',
              'text-font': ['Noto Sans Regular'],
            },
            paint: {
              'text-color': '#3B3228',
              'text-halo-color': '#FFFFFF',
              'text-halo-width': 1.4,
            },
          })
          m.on('mouseenter', DOTS, () => {
            m.getCanvas().style.cursor = 'pointer'
          })
          m.on('mouseleave', DOTS, () => {
            m.getCanvas().style.cursor = ''
          })
          setReady(true)
        })
        m.on('click', (event) => {
          const [hit] = m.queryRenderedFeatures(event.point, { layers: [DOTS] })
          const id = hit?.properties['id']
          if (typeof id === 'string') {
            callbacks.current.onSelect(id)
          } else {
            callbacks.current.onMapClick({
              lat: event.lngLat.lat,
              lon: event.lngLat.lng,
            })
          }
        })
        mapRef.current = m
      })
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
    }
  }, [])

  // Venue dots (the selected one is a draggable marker instead).
  const selectedId = selected?.id ?? null
  useEffect(() => {
    const source = mapRef.current?.getSource<GeoJSONSource>(SOURCE)
    source?.setData(collection(venues, selectedId))
  }, [ready, venues, selectedId])

  // Fly to a newly selected venue, close enough to place a pin.
  // Only when the selection changes, not when the venue is dragged.
  useEffect(() => {
    const map = mapRef.current
    const at = callbacks.current.selected?.at
    if (!map || !ready || !selectedId || !at) return
    map.easeTo({
      center: [at.lon, at.lat],
      zoom: Math.max(map.getZoom(), 19),
      duration: 600,
    })
  }, [ready, selectedId])

  // Draggable venue pin.
  useEffect(() => {
    const map = mapRef.current
    venueMarker.current?.remove()
    venueMarker.current = null
    if (!map || !ready || !selected) return
    const marker = new Marker({
      element: pinElement('admin-venue-pin', `${selected.name}: drag to move`),
      draggable: true,
    })
      .setLngLat([selected.at.lon, selected.at.lat])
      .addTo(map)
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLngLat()
      callbacks.current.onMoveVenue({ lat, lon: lng })
    })
    venueMarker.current = marker
  }, [ready, selected])

  // Terrace pin, draggable only in pin mode.
  useEffect(() => {
    const map = mapRef.current
    terraceMarker.current?.remove()
    terraceMarker.current = null
    if (!map || !ready || !selected || !terrace) return
    const marker = new Marker({
      element: pinElement(
        'admin-terrace-pin',
        pinning
          ? 'Terrace: drag or click the map'
          : 'Terrace (press T to move)',
      ),
      draggable: pinning,
    })
      .setLngLat([terrace.lon, terrace.lat])
      .addTo(map)
    marker.on('dragend', () => {
      const { lat, lng } = marker.getLngLat()
      callbacks.current.onPinTerrace({ lat, lon: lng })
    })
    terraceMarker.current = marker
  }, [ready, selected, terrace, pinning])

  return (
    <div
      ref={containerRef}
      className={pinning ? 'admin-map admin-pinning' : 'admin-map'}
    />
  )
}

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
import { useEffect, useRef, useState, type RefObject } from 'react'
import { BADAJOZ_CENTER, BASEMAP_STYLE_URL } from '../config.ts'
import type { LatLon } from '../data/terraces.ts'
import { sunlitStyle } from '../map/mapStyle.ts'
import { STATE_COLORS, type MapVenue } from './mapState.ts'

setWorkerUrl(workerUrl)

/** What the admin can ask of the map from outside. */
export type AdminMapControl = {
  centerOn: (at: LatLon) => void
  /** Keeps the map's centre above a bottom sheet this tall (phones). */
  setBottomInset: (px: number) => void
  /** The map position under a point of the page (e.g. a crosshair). */
  latLonAt: (clientX: number, clientY: number) => LatLon
}

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
  /** The terrace pin's position while it is dragged, before onPinTerrace. */
  onDragTerrace: (at: LatLon) => void
  onMoveVenue: (at: LatLon) => void
  /** The device's position ("Where am I"), with its accuracy in metres. */
  me?: { at: LatLon; accuracy: number } | null
  control?: RefObject<AdminMapControl | null>
  /** A position a visitor report proposes, shown until accepted or dismissed. */
  proposed?: LatLon | null
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
  onDragTerrace,
  onMoveVenue,
  me = null,
  control,
  proposed = null,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const venueMarker = useRef<Marker | null>(null)
  const terraceMarker = useRef<Marker | null>(null)
  const meMarker = useRef<Marker | null>(null)
  const proposedMarker = useRef<Marker | null>(null)
  // Applied on the next move only, so resizing the sheet never jumps the map.
  const bottomInset = useRef(0)
  const callbacks = useRef({
    onSelect,
    onMapClick,
    onPinTerrace,
    onDragTerrace,
    onMoveVenue,
    selected,
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    callbacks.current = {
      onSelect,
      onMapClick,
      onPinTerrace,
      onDragTerrace,
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
          // Clicks on the venue or terrace pin are grabs, not map clicks.
          const target = event.originalEvent.target
          if (target instanceof Element && target.closest('.maplibregl-marker'))
            return
          // Fingers are wide: on touch screens, take the nearest dot within reach.
          const reach = window.matchMedia('(pointer: coarse)').matches ? 18 : 0
          const { x, y } = event.point
          const hits = m.queryRenderedFeatures(
            [
              [x - reach, y - reach],
              [x + reach, y + reach],
            ],
            { layers: [DOTS] },
          )
          const [hit] = hits
            .map((feature) => {
              const [lon, lat] =
                feature.geometry.type === 'Point'
                  ? feature.geometry.coordinates
                  : []
              const p = m.project([lon ?? 0, lat ?? 0])
              return { feature, d: Math.hypot(p.x - x, p.y - y) }
            })
            .sort((a, b) => a.d - b.d)
            .map((h) => h.feature)
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
        if (control)
          control.current = {
            centerOn: (at) =>
              m.easeTo({
                center: [at.lon, at.lat],
                zoom: Math.max(m.getZoom(), 18),
                padding: {
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: bottomInset.current,
                },
                duration: 600,
              }),
            setBottomInset: (px) => {
              bottomInset.current = px
            },
            latLonAt: (clientX, clientY) => {
              const box = container.getBoundingClientRect()
              const { lat, lng } = m.unproject([
                clientX - box.left,
                clientY - box.top,
              ])
              return { lat, lon: lng }
            },
          }
      })
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      if (control) control.current = null
    }
  }, [control])

  // "Where am I": a dot with an accuracy ring, not interactive.
  const meLat = me?.at.lat
  const meLon = me?.at.lon
  const meAccuracy = me?.accuracy
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || meLat === undefined || meLon === undefined) {
      meMarker.current?.remove()
      meMarker.current = null
      return
    }
    if (!meMarker.current) {
      const el = pinElement('admin-me', 'You are here')
      el.append(document.createElement('span'))
      meMarker.current = new Marker({ element: el })
        .setLngLat([meLon, meLat])
        .addTo(map)
    }
    meMarker.current.setLngLat([meLon, meLat])
    // The accuracy ring's diameter in pixels at the current zoom, capped.
    const ring = meMarker.current.getElement().firstElementChild
    const fit = () => {
      if (!(ring instanceof HTMLElement) || meAccuracy === undefined) return
      const metresPerPixel =
        (40_075_016 * Math.cos((meLat * Math.PI) / 180)) /
        (512 * 2 ** map.getZoom())
      const size = Math.max(
        16,
        Math.min(400, (2 * meAccuracy) / metresPerPixel),
      )
      ring.style.width = ring.style.height = `${size}px`
    }
    fit()
    map.on('zoom', fit)
    return () => {
      map.off('zoom', fit)
    }
  }, [ready, meLat, meLon, meAccuracy])

  // A reported position, not interactive.
  useEffect(() => {
    const map = mapRef.current
    proposedMarker.current?.remove()
    proposedMarker.current = null
    if (!map || !ready || !proposed) return
    proposedMarker.current = new Marker({
      element: pinElement('admin-proposed-pin', 'Reported position'),
    })
      .setLngLat([proposed.lon, proposed.lat])
      .addTo(map)
  }, [ready, proposed])

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
      padding: { top: 0, left: 0, right: 0, bottom: bottomInset.current },
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
    marker.on('drag', () => {
      const { lat, lng } = marker.getLngLat()
      callbacks.current.onDragTerrace({ lat, lon: lng })
    })
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

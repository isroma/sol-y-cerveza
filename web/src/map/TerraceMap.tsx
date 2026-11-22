import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import { BADAJOZ_CENTER, BASEMAP_STYLE_URL, DEFAULT_ZOOM } from '../config.ts'
import type { SunState } from '../sun/sunState.ts'
import { STATE_COLORS, STATE_LABELS } from '../ui/stateStyle.ts'
import { verificationLabel } from '../ui/verification.ts'

// MapLibre looks for its worker next to its own module, which bundling breaks.
// Let Vite bundle the worker and tell MapLibre where it ended up.
setWorkerUrl(workerUrl)

const SOURCE_ID = 'terraces'
const LAYER_ID = 'terrace-circles'

// Spanish labels for the MapLibre controls this map uses.
const MAP_LOCALE = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
  'AttributionControl.MapFeedback': 'Comentarios sobre el mapa',
  'Map.Title': 'Mapa',
  'NavigationControl.ResetBearing':
    'Arrastra para girar el mapa; pulsa para orientarlo al norte',
  'NavigationControl.ZoomIn': 'Acercar',
  'NavigationControl.ZoomOut': 'Alejar',
  'Popup.Close': 'Cerrar',
}

export type MapTerrace = {
  id: string
  name: string
  lat: number
  lon: number
  state: SunState
  verified: string | null
}

type TerraceFeatureCollection = {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Point'; coordinates: [number, number] }
    properties: { id: string; state: SunState; label: string }
  }[]
}

function toFeatureCollection(
  terraces: readonly MapTerrace[],
): TerraceFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: terraces.map((terrace) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [terrace.lon, terrace.lat] },
      properties: {
        id: terrace.id,
        state: terrace.state,
        label: `${terrace.name}: ${STATE_LABELS[terrace.state]} · ${verificationLabel(terrace.verified)}`,
      },
    })),
  }
}

export function TerraceMap({ terraces }: { terraces: readonly MapTerrace[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  // Latest data, for when the style finishes loading after the first render.
  const dataRef = useRef<TerraceFeatureCollection>(toFeatureCollection([]))
  const fittedRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    fittedRef.current = false

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      center: BADAJOZ_CENTER,
      zoom: DEFAULT_ZOOM,
      locale: MAP_LOCALE,
    })
    map.addControl(new NavigationControl(), 'top-right')

    map.on('load', () => {
      map.addSource(SOURCE_ID, { type: 'geojson', data: dataRef.current })
      map.addLayer({
        id: LAYER_ID,
        type: 'circle',
        source: SOURCE_ID,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 17, 11],
          'circle-color': [
            'match',
            ['get', 'state'],
            'sun',
            STATE_COLORS.sun,
            'shade',
            STATE_COLORS.shade,
            'night',
            STATE_COLORS.night,
            STATE_COLORS.unknown,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })
    })

    const popup = new Popup({ closeButton: false, offset: 10 })
    popupRef.current = popup
    map.on('click', LAYER_ID, (event) => {
      const label: unknown = event.features?.[0]?.properties['label']
      if (typeof label !== 'string') return
      popup.setLngLat(event.lngLat).setText(label).addTo(map)
    })
    map.on('mouseenter', LAYER_ID, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
    })

    mapRef.current = map
    return () => {
      mapRef.current = null
      popupRef.current = null
      map.remove()
    }
  }, [])

  useEffect(() => {
    const data = toFeatureCollection(terraces)
    dataRef.current = data
    // An open popup would show a stale state.
    popupRef.current?.remove()
    const map = mapRef.current
    if (!map) return
    void map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(data)

    // Frame the terraces once; later updates only change their states.
    if (!fittedRef.current && terraces.length > 0) {
      const bounds = new LngLatBounds()
      for (const terrace of terraces) bounds.extend([terrace.lon, terrace.lat])
      // Extra bottom padding clears the attribution, expanded at first.
      map.fitBounds(bounds, {
        padding: { top: 48, right: 56, bottom: 72, left: 48 },
        maxZoom: 16,
        animate: false,
      })
      fittedRef.current = true
    }
  }, [terraces])

  return (
    <div
      ref={containerRef}
      className="terrace-map"
      role="region"
      aria-label="Mapa de terrazas de Badajoz"
    />
  )
}

import {
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
} from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { useEffect, useRef } from 'react'
import { BADAJOZ_CENTER, BASEMAP_STYLE_URL, DEFAULT_ZOOM } from '../config.ts'

// MapLibre looks for its worker next to its own module, which bundling breaks.
// Let Vite bundle the worker and tell MapLibre where it ended up.
setWorkerUrl(workerUrl)

export function TerraceMap() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const map = new MapLibreMap({
      container,
      style: BASEMAP_STYLE_URL,
      center: BADAJOZ_CENTER,
      zoom: DEFAULT_ZOOM,
    })
    map.addControl(new NavigationControl(), 'top-right')

    return () => map.remove()
  }, [])

  return (
    <div
      ref={containerRef}
      className="terrace-map"
      role="region"
      aria-label="Mapa de terrazas de Badajoz"
    />
  )
}

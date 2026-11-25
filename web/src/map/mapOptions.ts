import type { MapOptions } from 'maplibre-gl'
import { pitchForZoom } from './camera.ts'

/** City overview in the top view: the old town, the river and the south-west districts. */
export const INITIAL_ZOOM = 13.8
export const INITIAL_VIEW = {
  center: [-6.978, 38.8725] as [number, number],
  zoom: INITIAL_ZOOM,
  pitch: pitchForZoom(INITIAL_ZOOM),
  bearing: 0,
}

export const MAP_LOCALE = {
  'AttributionControl.ToggleAttribution': 'Mostrar u ocultar la atribución',
  'AttributionControl.MapFeedback': 'Comentarios sobre el mapa',
  'Map.Title': 'Mapa',
}

/**
 * The app map's construction options, apart from its container, style and
 * attribution (MapView sets those).
 */
export const MAP_OPTIONS = {
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
} satisfies Partial<MapOptions>

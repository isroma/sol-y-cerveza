import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { useRef, useState, type RefObject } from 'react'
import { CategoryIcon } from '../ui/CategoryIcon.tsx'
import { pitchForZoom } from './camera.ts'
import { CATEGORY_LABELS } from '../ui/categoryStyle.ts'
import {
  ChevronDownIcon,
  CloseIcon,
  InfoIcon,
  LocateIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
} from '../ui/icons.tsx'

const BADAJOZ_BOUNDS = { south: 38.84, west: -7.04, north: 38.92, east: -6.92 }

type Props = {
  mapRef: RefObject<MapLibreMap | null>
  ready: boolean
  attribution: readonly string[]
}

export function MapControls({ mapRef, ready, attribution }: Props) {
  const [cityOpen, setCityOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [locateError, setLocateError] = useState<string | null>(null)
  const userMarker = useRef<Marker | null>(null)

  const map = () => (ready ? mapRef.current : null)

  // Zoom with the matching tilt, so the camera moves in one smooth step.
  const zoomBy = (delta: number) => {
    const m = map()
    if (!m) return
    const zoom = m.getZoom() + delta
    m.easeTo({ zoom, pitch: pitchForZoom(zoom), duration: 400 })
  }

  const locate = () => {
    setLocateError(null)
    if (!('geolocation' in navigator)) {
      setLocateError('Tu navegador no permite localizarte.')
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const m = map()
        if (!m) return
        const { latitude: lat, longitude: lon } = coords
        const el = document.createElement('div')
        el.className = 'user-dot'
        userMarker.current?.remove()
        userMarker.current = new Marker({ element: el })
          .setLngLat([lon, lat])
          .addTo(m)
        const inside =
          lat > BADAJOZ_BOUNDS.south &&
          lat < BADAJOZ_BOUNDS.north &&
          lon > BADAJOZ_BOUNDS.west &&
          lon < BADAJOZ_BOUNDS.east
        if (inside)
          m.flyTo({
            center: [lon, lat],
            zoom: 17,
            pitch: pitchForZoom(17),
            duration: 1200,
          })
        else
          setLocateError(
            'Estás fuera de Badajoz: de momento solo cubrimos Badajoz.',
          )
      },
      () => setLocateError('No hemos podido obtener tu ubicación.'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <>
      <div className="map-city">
        <button
          type="button"
          className="map-pill"
          aria-haspopup="menu"
          aria-expanded={cityOpen}
          onClick={() => setCityOpen(!cityOpen)}
        >
          <PinIcon size={20} />
          Badajoz
          <ChevronDownIcon size={18} />
        </button>
        {cityOpen && (
          <ul className="map-menu" role="menu">
            <li role="menuitemradio" aria-checked="true">
              Badajoz
            </li>
            <li role="menuitem" aria-disabled="true" className="muted">
              Más ciudades, próximamente
            </li>
          </ul>
        )}
      </div>

      <div className="map-buttons">
        <button
          type="button"
          className="map-round"
          aria-label="Mi ubicación"
          onClick={locate}
        >
          <LocateIcon size={20} />
        </button>
        <div className="map-zoom">
          <button type="button" aria-label="Acercar" onClick={() => zoomBy(1)}>
            <PlusIcon size={20} />
          </button>
          <button type="button" aria-label="Alejar" onClick={() => zoomBy(-1)}>
            <MinusIcon size={20} />
          </button>
        </div>
      </div>

      {locateError && (
        <p className="map-toast" role="status">
          {locateError}
          <button
            type="button"
            className="icon-button"
            aria-label="Cerrar"
            onClick={() => setLocateError(null)}
          >
            <CloseIcon size={14} />
          </button>
        </p>
      )}

      <aside className="map-legend" aria-label="Leyenda">
        <ul>
          {(['sun', 'soon', 'nosun'] as const).map((category) => (
            <li key={category}>
              <CategoryIcon category={category} size={22} />
              {CATEGORY_LABELS[category]}
            </li>
          ))}
          <li>
            <span className="legend-dot" aria-hidden="true" />
            {CATEGORY_LABELS.unknown}
          </li>
        </ul>
        <button
          type="button"
          className="icon-button legend-info"
          aria-label="Información sobre los datos"
          aria-expanded={infoOpen}
          onClick={() => setInfoOpen(!infoOpen)}
        >
          <InfoIcon size={20} />
        </button>
        {infoOpen && (
          <div className="map-info" role="dialog" aria-label="Sobre los datos">
            <h3>Sobre los datos</h3>
            <p>
              El sol y la sombra se calculan con la posición del sol y el
              relieve de edificios y árboles (LiDAR del PNOA). Las terrazas aún
              no están verificadas sobre el terreno.
            </p>
            <p>
              <strong>Precios, valoraciones e imágenes son de ejemplo</strong>:
              todavía no hay datos abiertos de ellos.
            </p>
            <ul className="map-info-sources">
              {attribution.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </>
  )
}

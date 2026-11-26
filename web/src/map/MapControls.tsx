import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'
import { BADAJOZ_BBOX } from '../data/geo.ts'
import { track } from '../telemetry.ts'
import { CategoryIcon } from '../ui/CategoryIcon.tsx'
import { pitchForZoom } from './camera.ts'
import { CATEGORY_LABELS, LEAF_OFF_INFO } from '../ui/categoryStyle.ts'
import { PrivacyNotice } from '../ui/PrivacyNotice.tsx'
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  CloseIcon,
  CompassIcon,
  InfoIcon,
  LocateIcon,
  MinusIcon,
  PinIcon,
  PlusIcon,
} from '../ui/icons.tsx'

type Props = {
  mapRef: RefObject<MapLibreMap | null>
  ready: boolean
  attribution: readonly string[]
  /** The data has leaf-off horizons (ADR-0007): explain the winter rule. */
  leafOffTrees: boolean
}

export function MapControls({
  mapRef,
  ready,
  attribution,
  leafOffTrees,
}: Props) {
  const [cityOpen, setCityOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  /** The info panel shows the privacy notice instead of "Sobre los datos". */
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const legendRef = useRef<HTMLElement>(null)
  const infoMaxHeight = useInfoMaxHeight(legendRef, infoOpen)
  // Focus follows the panel's view: the back button when the notice opens,
  // the "Privacidad" link when it goes back. Only after those clicks.
  const backRef = useRef<HTMLButtonElement>(null)
  const privacyLinkRef = useRef<HTMLButtonElement>(null)
  const focusAfterSwitch = useRef(false)
  useEffect(() => {
    if (!focusAfterSwitch.current) return
    focusAfterSwitch.current = false
    ;(privacyOpen ? backRef : privacyLinkRef).current?.focus()
  }, [privacyOpen])
  const showPrivacy = (show: boolean) => {
    focusAfterSwitch.current = true
    setPrivacyOpen(show)
  }
  const [locateError, setLocateError] = useState<string | null>(null)
  const userMarker = useRef<Marker | null>(null)
  const [bearing, setBearing] = useState(0)

  const map = () => (ready ? mapRef.current : null)

  // The compass needle follows the map's rotation.
  useEffect(() => {
    const m = ready ? mapRef.current : null
    if (!m) return
    const update = () => setBearing(m.getBearing())
    update()
    m.on('rotate', update)
    return () => {
      m.off('rotate', update)
    }
  }, [mapRef, ready])

  const faceNorth = () => map()?.easeTo({ bearing: 0, duration: 400 })

  // Zoom with the matching tilt, so the camera moves in one smooth step.
  const zoomBy = (delta: number) => {
    const m = map()
    if (!m) return
    const zoom = m.getZoom() + delta
    m.easeTo({ zoom, pitch: pitchForZoom(zoom), duration: 400 })
  }

  // The last fix, and the browser watch that keeps the dot following you.
  const lastFix = useRef<[number, number] | null>(null)
  const watchId = useRef<number | null>(null)

  const stopWatching = () => {
    if (watchId.current !== null)
      navigator.geolocation.clearWatch(watchId.current)
    watchId.current = null
  }

  useEffect(() => stopWatching, [])

  const flyToUser = ([lon, lat]: [number, number]) => {
    const m = map()
    if (!m) return
    const inside =
      lat > BADAJOZ_BBOX.south &&
      lat < BADAJOZ_BBOX.north &&
      lon > BADAJOZ_BBOX.west &&
      lon < BADAJOZ_BBOX.east
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
  }

  // The first tap starts following you; later taps centre the map on the dot.
  const locate = () => {
    track('locate')
    setLocateError(null)
    if (!('geolocation' in navigator)) {
      setLocateError('Tu navegador no permite localizarte.')
      return
    }
    if (watchId.current !== null) {
      if (lastFix.current) flyToUser(lastFix.current)
      return
    }
    watchId.current = navigator.geolocation.watchPosition(
      ({ coords }) => {
        const m = map()
        if (!m) return
        const fix: [number, number] = [coords.longitude, coords.latitude]
        const first = lastFix.current === null
        lastFix.current = fix
        if (!userMarker.current) {
          const el = document.createElement('div')
          el.className = 'user-dot'
          userMarker.current = new Marker({ element: el })
        }
        userMarker.current.setLngLat(fix).addTo(m)
        if (first) flyToUser(fix)
      },
      (error) => {
        // A lost signal while following keeps the last dot; anything else
        // stops, so the next tap asks again.
        if (lastFix.current && error.code !== error.PERMISSION_DENIED) return
        stopWatching()
        lastFix.current = null
        userMarker.current?.remove()
        userMarker.current = null
        setLocateError('No hemos podido obtener tu ubicación.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
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
              Más ciudades próximamente
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
        <button
          type="button"
          className="map-round"
          aria-label="Orientar al norte"
          title="Orientar al norte"
          onClick={faceNorth}
        >
          <CompassIcon
            size={22}
            className="compass-needle"
            style={{ rotate: `${-bearing}deg` }}
          />
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

      <div className="map-bottom">
        <aside className="map-legend" aria-label="Leyenda" ref={legendRef}>
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
            onClick={() => {
              setInfoOpen(!infoOpen)
              setPrivacyOpen(false)
            }}
          >
            <InfoIcon size={20} />
          </button>
          {infoOpen && privacyOpen && (
            <div
              className="map-info"
              role="dialog"
              aria-label="Privacidad"
              style={infoMaxHeight}
            >
              <div className="map-info-head">
                <button
                  type="button"
                  className="icon-button map-info-back"
                  aria-label="Volver a Sobre los datos"
                  title="Volver"
                  ref={backRef}
                  onClick={() => showPrivacy(false)}
                >
                  <ChevronLeftIcon size={20} />
                </button>
                <h3>Privacidad</h3>
              </div>
              <PrivacyNotice />
            </div>
          )}
          {infoOpen && !privacyOpen && (
            <div
              className="map-info"
              role="dialog"
              aria-label="Sobre los datos"
              style={infoMaxHeight}
            >
              <h3>Sobre los datos</h3>
              <p>
                Sol y sombra calculados con la posición del sol y el relieve de
                edificios y árboles (LiDAR del PNOA).
                {leafOffTrees && ` ${LEAF_OFF_INFO}`} Puede haber errores: si
                ves alguno, usa «Sugerir un cambio» en la ficha del bar.
              </p>
              <ul className="map-info-sources">
                <li>
                  Mapa base:{' '}
                  <a
                    href="https://openfreemap.org"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenFreeMap
                  </a>{' '}
                  <a
                    href="https://www.openmaptiles.org/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    © OpenMapTiles
                  </a>
                  , datos de{' '}
                  <a
                    href="https://www.openstreetmap.org/copyright"
                    target="_blank"
                    rel="noreferrer"
                  >
                    OpenStreetMap
                  </a>
                </li>
                {attribution.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <button
                type="button"
                className="map-info-link"
                ref={privacyLinkRef}
                onClick={() => showPrivacy(true)}
              >
                Privacidad
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}

/** The info panel's height when the room above the legend can't be measured or is tiny. */
export const MIN_INFO_HEIGHT = 160

/**
 * The info panel opens above the legend: cap its height at the room between
 * the legend and the top of the map, so a long text (the privacy notice)
 * scrolls inside the panel instead of running off the map. Measured, since
 * the legend's height depends on the layout, and measured again whenever the
 * map or the legend changes size (a rotation, the legend hidden while a
 * card's back shows on phones and shown again). Never less than
 * MIN_INFO_HEIGHT, and never uncapped while open.
 */
function useInfoMaxHeight(
  legendRef: RefObject<HTMLElement | null>,
  open: boolean,
): { maxHeight: string } | undefined {
  const [maxHeight, setMaxHeight] = useState<number | null>(null)
  // Before paint, so the panel never shows at the wrong height first.
  useLayoutEffect(() => {
    if (!open) return
    const legend = legendRef.current
    const wrap = legend?.closest('.map-wrap')
    if (!legend || !wrap) return
    const measure = () => {
      const legendBox = legend.getBoundingClientRect()
      // Hidden (display: none): nothing to place the panel against; keep
      // the last height and wait for the legend to come back.
      if (legendBox.width === 0 && legendBox.height === 0) return
      const style = getComputedStyle(legend)
      const gap = parseFloat(style.getPropertyValue('--space-3')) || 12
      const inset = parseFloat(style.getPropertyValue('--map-inset')) || 16
      const room =
        legendBox.top - wrap.getBoundingClientRect().top - gap - inset
      setMaxHeight(Math.max(MIN_INFO_HEIGHT, Math.floor(room)))
    }
    measure()
    window.addEventListener('resize', measure)
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(wrap)
    observer?.observe(legend)
    return () => {
      window.removeEventListener('resize', measure)
      observer?.disconnect()
    }
  }, [legendRef, open])
  if (!open) return undefined
  return { maxHeight: `${maxHeight ?? MIN_INFO_HEIGHT}px` }
}

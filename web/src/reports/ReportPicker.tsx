import { useEffect, useRef, useState } from 'react'
import {
  cleanVenueName,
  distanceMetres,
  insideBadajoz,
  type LatLon,
} from '../data/geo.ts'
import { TURNSTILE_SITE_KEY } from '../apiClient.ts'
import { useOwner } from '../prices/owner.ts'
import { Turnstile } from './Turnstile.tsx'
import { KIND_LABELS } from '../ui/categoryStyle.ts'
import { Toggle } from '../ui/Toggle.tsx'
import type { Picking } from './picking.ts'
import {
  MAX_MOVE_M,
  MIN_MOVE_M,
  ownerAddVenue,
  OWNER_RESULT_TEXT,
  reportVenue,
  RESULT_TEXT,
  validName,
  type AddKind,
} from './reports.ts'
import './reports.css'

const ADD_KINDS: readonly AddKind[] = ['bar', 'cafe', 'restaurant', 'pub']

type Props = {
  picking: Picking
  /** The map's centre, under the fixed pin; null until the map reports it. */
  center: LatLon | null
  /** A move's spot, handed back to the card's back, which sends it. */
  onPlace: (spot: LatLon) => void
  onClose: () => void
}

/**
 * Places a venue on the map: a fixed pin at the centre of the map, which the
 * visitor pans and zooms under it, and a bottom bar. A new venue is sent from
 * here; a move goes back to its card's back with Listo, sent with the rest.
 */
export function ReportPicker({ picking, center, onPlace, onClose }: Props) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AddKind>('bar')
  const [terrace, setTerrace] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  // What the visitor or owner sees once it is sent.
  const [result, setResult] = useState<string | null>(null)
  const owner = useOwner().token !== null
  const barRef = useRef<HTMLElement>(null)

  // Focus moves into the bar, and back where it was when the picker closes,
  // or to the map when that is gone (the card, or the closed phone menu).
  useEffect(() => {
    const previous = document.activeElement
    barRef.current?.focus()
    return () => {
      const target =
        previous instanceof HTMLElement && previous.offsetParent !== null
          ? previous
          : document.querySelector<HTMLElement>('.maplibregl-canvas')
      target?.focus({ preventScroll: true })
    }
  }, [])

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Move: from where its badge is; the API measures from the venue's position.
  const venue = picking.kind === 'move' ? picking.venue : null
  const start = venue ? (venue.terrace ?? venue.venue) : null
  const moved =
    start === null ||
    (center !== null && distanceMetres(start, center) > MIN_MOVE_M)
  const tooFar =
    venue !== null &&
    center !== null &&
    distanceMetres(venue.venue, center) > MAX_MOVE_M
  const outside = center !== null && !insideBadajoz(center)
  const ready =
    center !== null &&
    (venue !== null || owner || token !== null) &&
    moved &&
    !tooFar &&
    !outside &&
    (venue !== null || validName(name))

  const send = () => {
    if (!ready || center === null) return
    if (venue) {
      onPlace(center)
      return
    }
    const added = {
      kind: 'add' as const,
      name: cleanVenueName(name),
      venueKind: kind,
      terrace,
      lat: center.lat,
      lon: center.lon,
    }
    // The owner's new venue is added at the admin's next Publish.
    const sent = owner
      ? ownerAddVenue(added).then((answer) =>
          answer === 'ok' ? OWNER_RESULT_TEXT.later : OWNER_RESULT_TEXT.error,
        )
      : token === null
        ? null
        : reportVenue({ ...added, token }).then((answer) => RESULT_TEXT[answer])
    if (!sent) return
    setSending(true)
    void sent.then((text) => {
      setSending(false)
      setResult(text)
    })
  }

  const label = venue ? `Mover ${venue.name}` : 'Añadir un bar'

  return (
    <>
      {!result && (
        <div className="picker-pin" aria-hidden="true">
          <svg width="36" height="48" viewBox="0 0 36 48">
            <path
              d="M18 46C18 46 33 29 33 17A15 15 0 0 0 3 17C3 29 18 46 18 46Z"
              fill="var(--ink)"
              stroke="var(--bg)"
              strokeWidth="3"
            />
            <circle cx="18" cy="17" r="5.5" fill="var(--bg)" />
          </svg>
        </div>
      )}
      <section
        ref={barRef}
        className="picker-bar"
        aria-label={label}
        tabIndex={-1}
      >
        {result ? (
          <div className="picker-form">
            <p className="picker-text" role="status">
              {result}
            </p>
            <div className="picker-actions">
              <button type="button" className="picker-send" onClick={onClose}>
                Cerrar
              </button>
            </div>
          </div>
        ) : (
          <form
            className="picker-form"
            onSubmit={(event) => {
              event.preventDefault()
              send()
            }}
          >
            <p className="picker-text" role="status">
              {outside
                ? 'Ese sitio está fuera de Badajoz.'
                : tooFar
                  ? 'Está a más de 500 m. Solo podemos corregir posiciones cercanas.'
                  : 'Mueve el mapa hasta el sitio correcto'}
            </p>
            {picking.kind === 'add' && (
              <>
                <input
                  className="picker-name"
                  aria-label="Nombre"
                  placeholder="Nombre del bar"
                  maxLength={60}
                  autoComplete="off"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <div className="picker-row">
                  <select
                    aria-label="Tipo"
                    value={kind}
                    onChange={(event) => {
                      const picked = ADD_KINDS.find(
                        (k) => k === event.target.value,
                      )
                      if (picked) setKind(picked)
                    }}
                  >
                    {ADD_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <label className="picker-toggle">
                    <span aria-hidden="true">Tiene terraza</span>
                    <Toggle
                      checked={terrace}
                      onChange={setTerrace}
                      label="Tiene terraza"
                    />
                  </label>
                </div>
              </>
            )}
            {TURNSTILE_SITE_KEY && !venue && !owner && (
              <Turnstile
                siteKey={TURNSTILE_SITE_KEY}
                action="report"
                onToken={setToken}
              />
            )}
            <div className="picker-actions">
              <button type="button" onClick={onClose}>
                Cancelar
              </button>
              <button
                type="submit"
                className="picker-send"
                disabled={!ready || sending}
              >
                {venue
                  ? 'Listo'
                  : sending
                    ? owner
                      ? 'Guardando…'
                      : 'Enviando…'
                    : owner
                      ? 'Guardar'
                      : 'Enviar'}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  )
}

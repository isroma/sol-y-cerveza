import { useEffect, useRef, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY, type SuggestResult } from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import { KIND_LABELS } from '../ui/categoryStyle.ts'
import { Toggle } from '../ui/Toggle.tsx'
import type { Picking } from './picking.ts'
import {
  cleanName,
  distanceMetres,
  insideBadajoz,
  MAX_MOVE_M,
  MAX_PIN_M,
  MIN_MOVE_M,
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
  onClose: () => void
}

/**
 * Places a venue on the map: a fixed pin at the centre of the map, which the
 * visitor pans and zooms under it, and a bottom bar to send or cancel.
 */
export function ReportPicker({ picking, center, onClose }: Props) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AddKind>('bar')
  const [terrace, setTerrace] = useState(true)
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SuggestResult | null>(null)
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

  // Move and pin: from where its badge is; the API measures from the venue's
  // position. Tables right at the door of a venue without a terrace are a
  // fine answer, so that pin needn't move.
  const venue = picking.kind === 'add' ? null : picking.venue
  const start = venue ? (venue.terrace ?? venue.venue) : null
  const mustMove =
    picking.kind === 'move' || (picking.kind === 'pin' && !!venue?.terrace)
  const moved =
    !mustMove ||
    start === null ||
    (center !== null && distanceMetres(start, center) > MIN_MOVE_M)
  const maxM = picking.kind === 'pin' ? MAX_PIN_M : MAX_MOVE_M
  const tooFar =
    venue !== null &&
    center !== null &&
    distanceMetres(venue.venue, center) > maxM
  const outside = center !== null && !insideBadajoz(center)
  const ready =
    center !== null &&
    token !== null &&
    moved &&
    !tooFar &&
    !outside &&
    (picking.kind !== 'add' || validName(name))

  const send = () => {
    if (!ready || center === null || token === null) return
    setSending(true)
    const sent = venue
      ? reportVenue({
          kind: picking.kind === 'pin' ? 'pin' : 'move',
          venueId: venue.id,
          lat: center.lat,
          lon: center.lon,
          token,
        })
      : reportVenue({
          kind: 'add',
          name: cleanName(name),
          venueKind: kind,
          terrace,
          lat: center.lat,
          lon: center.lon,
          token,
        })
    void sent.then((answer) => {
      setSending(false)
      setResult(answer)
    })
  }

  const label = !venue
    ? 'Añadir un bar'
    : picking.kind === 'pin'
      ? `Terraza de ${venue.name}`
      : `Mover ${venue.name}`

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
              {RESULT_TEXT[result]}
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
                  ? picking.kind === 'pin'
                    ? `La terraza tiene que estar a menos de ${MAX_PIN_M} m del bar.`
                    : 'Está a más de 500 m. Solo podemos corregir posiciones cercanas.'
                  : picking.kind === 'pin'
                    ? 'Mueve el mapa hasta las mesas'
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
            {TURNSTILE_SITE_KEY && (
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
                {sending ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  )
}

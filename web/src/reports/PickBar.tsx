import { useEffect, useRef, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY } from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import { KIND_LABELS } from '../ui/categoryStyle.ts'
import { Toggle } from '../ui/Toggle.tsx'
import {
  NAME_MAX,
  nameOk,
  pickProblem,
  pickReport,
  REPORT_ACTION,
  RESULT_TEXT,
  sendReport,
  type Pick,
  type ReportResult,
  type VenueKind,
} from './reports.ts'

type Props = {
  pick: Pick
  /** The point under the centre pin, read when sending. */
  center: () => LatLon | null
  /** Closes the picker (cancelled, or a while after a sent report). */
  onClose: () => void
}

const KINDS = Object.keys(KIND_LABELS).filter(
  (k): k is VenueKind => k in KIND_LABELS,
)

function prompt(pick: Pick): string {
  switch (pick.kind) {
    case 'pin':
      return `Mueve el mapa hasta las mesas de ${pick.name}`
    case 'move':
      return `Mueve el mapa hasta la puerta de ${pick.name}`
    case 'add':
      return 'Mueve el mapa hasta el bar que falta'
  }
}

/** How long the thanks stay before the picker closes by itself. */
const THANKS_MS = 2500

/**
 * The bottom bar of the map picker: the visitor pans the map under a fixed
 * centre pin, then sends. For a missing bar it also asks the name, the kind
 * and whether it has a terrace.
 */
export function PickBar({ pick, center, onClose }: Props) {
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [venueKind, setVenueKind] = useState<VenueKind>('bar')
  const [terrace, setTerrace] = useState(true)
  // The parent re-renders often (the clock, the zoom): keep the latest
  // callback without restarting the timers below.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })

  useEffect(() => {
    if (result !== 'ok') return
    const timer = window.setTimeout(() => close.current(), THANKS_MS)
    return () => window.clearTimeout(timer)
  }, [result])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!TURNSTILE_SITE_KEY) return null
  const adding = pick.kind === 'add'
  const ready = !!token && !sending && (!adding || nameOk(name))

  const submit = async () => {
    const at = center()
    if (!token || !at) return
    const why = pickProblem(pick, at)
    setProblem(why)
    if (why) return
    setSending(true)
    const outcome = await sendReport(
      pickReport(pick, at, { name, venueKind, terrace }),
      token,
    )
    setSending(false)
    setResult(outcome)
  }

  return (
    <form
      className="pick-bar"
      aria-label={adding ? 'Añadir un bar' : 'Elegir posición'}
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) void submit()
      }}
    >
      {result ? (
        <p
          className={`report-result${result === 'ok' ? ' is-ok' : ''}`}
          role="status"
        >
          {RESULT_TEXT[result]}
        </p>
      ) : (
        <>
          <p className="pick-bar-prompt">{prompt(pick)}</p>
          {adding && (
            <div className="pick-bar-fields">
              <input
                className="pick-field"
                aria-label="Nombre del bar"
                placeholder="Nombre del bar"
                maxLength={NAME_MAX}
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select
                className="pick-field"
                aria-label="Tipo"
                value={venueKind}
                onChange={(e) => {
                  const kind = KINDS.find((k) => k === e.target.value)
                  if (kind) setVenueKind(kind)
                }}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <label className="pick-toggle">
                <span>Tiene terraza</span>
                <Toggle
                  label="Tiene terraza"
                  checked={terrace}
                  onChange={setTerrace}
                />
              </label>
            </div>
          )}
          {problem && (
            <p className="pick-bar-problem" role="alert">
              {problem}
            </p>
          )}
        </>
      )}
      <Turnstile
        siteKey={TURNSTILE_SITE_KEY}
        action={REPORT_ACTION}
        onToken={setToken}
      />
      <div className="report-actions">
        <button type="button" className="report-cancel" onClick={onClose}>
          {result ? 'Cerrar' : 'Cancelar'}
        </button>
        {!result && (
          <button type="submit" className="report-send" disabled={!ready}>
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        )}
      </div>
    </form>
  )
}

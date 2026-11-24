import { useEffect, useRef, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY } from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import {
  CAN_REPORT,
  REPORT_ACTION,
  RESULT_TEXT,
  sendReport,
  type Report,
  type ReportResult,
} from './reports.ts'
import './reports.css'

type Props = {
  venue: Terrace
  /** Starts the map picker for the terrace (`pin`) or the venue (`move`). */
  onPick: (kind: 'pin' | 'move') => void
}

type Step = 'closed' | 'options' | 'confirm-closed'

/**
 * The card's one way to correct a venue: a quiet link that opens the
 * options. Answers that need no position are sent from here; positions are
 * placed with the map picker (PickBar).
 */
export function ReportSection({ venue, onPick }: Props) {
  const [step, setStep] = useState<Step>('closed')
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{
    report: Report
    result: ReportResult
  } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // The card is a map marker: stop drags, scrolls and keys natively so they
  // don't pan or zoom the map (see PriceSection). Clicks still reach React.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const stop = (event: Event) => event.stopPropagation()
    const events = ['mousedown', 'pointerdown', 'touchstart', 'dblclick']
    for (const name of [...events, 'keydown', 'wheel'])
      element.addEventListener(name, stop)
    return () => {
      for (const name of [...events, 'keydown', 'wheel'])
        element.removeEventListener(name, stop)
    }
  })

  if (!CAN_REPORT || !TURNSTILE_SITE_KEY) return null
  const hasTerrace = venue.terrace !== null

  const send = async (report: Report) => {
    if (!token) return
    setSending(true)
    const outcome = await sendReport(report, token)
    setSending(false)
    setResult({ report, result: outcome })
    // A token is single-use: the widget is remounted for the next report.
    setToken(null)
  }

  if (result) {
    const saidYes =
      result.result === 'ok' &&
      result.report.kind === 'terrace' &&
      result.report.terrace
    return (
      <div className="report-section" ref={ref}>
        <p
          className={`report-result${result.result === 'ok' ? ' is-ok' : ''}`}
          role="status"
        >
          {RESULT_TEXT[result.result]}
        </p>
        {saidYes && (
          <button
            type="button"
            className="report-link"
            onClick={() => onPick('pin')}
          >
            Marcar dónde están las mesas
          </button>
        )}
      </div>
    )
  }

  if (step === 'closed')
    return (
      <div className="report-section" ref={ref}>
        <button
          type="button"
          className="report-link"
          aria-expanded="false"
          onClick={() => setStep('options')}
        >
          {hasTerrace ? '¿Algo está mal?' : '¿Tiene terraza?'}
        </button>
      </div>
    )

  const disabled = !token || sending
  return (
    <div className="report-section" ref={ref}>
      {step === 'confirm-closed' ? (
        <div className="report-confirm">
          <p>
            ¿Seguro que <strong>{venue.name}</strong> ha cerrado o no existe?
          </p>
          <div className="report-actions">
            <button
              type="button"
              className="report-cancel"
              onClick={() => setStep('options')}
            >
              Volver
            </button>
            <button
              type="button"
              className="report-send"
              disabled={disabled}
              onClick={() => void send({ kind: 'closed', venueId: venue.id })}
            >
              {sending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      ) : (
        <ul className="report-options" aria-label="¿Qué pasa?">
          {!hasTerrace && (
            <li>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  void send({
                    kind: 'terrace',
                    venueId: venue.id,
                    terrace: true,
                  })
                }
              >
                Sí, tiene terraza
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                void send({
                  kind: 'terrace',
                  venueId: venue.id,
                  terrace: false,
                })
              }
            >
              No tiene terraza
            </button>
          </li>
          {hasTerrace && (
            <li>
              <button type="button" onClick={() => onPick('pin')}>
                La terraza está en otro sitio
              </button>
            </li>
          )}
          <li>
            <button type="button" onClick={() => onPick('move')}>
              El bar está en otro sitio
            </button>
          </li>
          <li>
            <button type="button" onClick={() => setStep('confirm-closed')}>
              Ha cerrado o no existe
            </button>
          </li>
          <li>
            <button
              type="button"
              className="report-cancel-option"
              onClick={() => setStep('closed')}
            >
              Cancelar
            </button>
          </li>
        </ul>
      )}
      <Turnstile
        siteKey={TURNSTILE_SITE_KEY}
        action={REPORT_ACTION}
        onToken={setToken}
      />
    </div>
  )
}

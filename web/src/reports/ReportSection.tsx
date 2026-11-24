import { useContext, useEffect, useRef, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY, type SuggestResult } from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import { StartMoveContext, StartPinContext } from './picking.ts'
import { CAN_REPORT, reportVenue, RESULT_TEXT, type Report } from './reports.ts'
import './reports.css'

type Step = 'idle' | 'choose' | 'closed'

/**
 * The card's one way to correct a venue: a quiet link ("¿Tiene terraza?" when
 * the terrace is unconfirmed, else "¿Algo está mal?") that opens the choices.
 * Terrace answers send in one tap; "Está en otro sitio" and "Mover la terraza"
 * open the map picker; "Ya no existe" is confirmed here.
 */
export function ReportSection({ venue }: { venue: Terrace }) {
  const startMove = useContext(StartMoveContext)
  const startPin = useContext(StartPinContext)
  const [step, setStep] = useState<Step>('idle')
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SuggestResult | null>(null)
  // A sent "Sí, tiene terraza" offers to place the tables.
  const [saidYes, setSaidYes] = useState(false)

  // The card is a map marker: stop drags, scrolls and keys natively so they
  // don't pan or zoom the map (as PriceSection does). Clicks reach React;
  // MapView ignores clicks on the card.
  const sectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sectionRef.current
    if (!element) return
    const stop = (event: Event) => event.stopPropagation()
    const events = [
      'mousedown',
      'pointerdown',
      'touchstart',
      'dblclick',
      'keydown',
      'wheel',
    ]
    for (const name of events) element.addEventListener(name, stop)
    return () => {
      for (const name of events) element.removeEventListener(name, stop)
    }
  })

  // Each step replaces the button that led to it: move focus into the new one.
  const moveFocus = useRef(false)
  useEffect(() => {
    if (!moveFocus.current) return
    moveFocus.current = false
    sectionRef.current
      ?.querySelector<HTMLElement>('[data-focus]')
      ?.focus({ preventScroll: true })
  }, [step, result])

  const go = (next: Step) => {
    moveFocus.current = true
    setStep(next)
  }

  if (!CAN_REPORT || !TURNSTILE_SITE_KEY) return null
  const hasTerrace = venue.terrace !== null

  const back = () => {
    go('idle')
    setToken(null)
  }

  const send = (report: Report) => {
    setSending(true)
    void reportVenue(report)
      .then((sent) => {
        moveFocus.current = true
        setSaidYes(sent === 'ok' && report.kind === 'terrace' && report.terrace)
        setResult(sent)
      })
      .finally(() => setSending(false))
  }

  const answer = (terrace: boolean) => {
    if (token) send({ kind: 'terrace', venueId: venue.id, terrace, token })
  }

  return (
    <div className="report-section" ref={sectionRef}>
      {result ? (
        <>
          <p className="report-result" role="status" tabIndex={-1} data-focus>
            {RESULT_TEXT[result]}
          </p>
          {saidYes && startPin && (
            <button
              type="button"
              className="report-link"
              onClick={() => startPin(venue)}
            >
              Marcar dónde están las mesas
            </button>
          )}
        </>
      ) : step === 'idle' ? (
        <button
          type="button"
          className="report-link"
          data-focus
          onClick={() => go('choose')}
        >
          {hasTerrace ? '¿Algo está mal?' : '¿Tiene terraza?'}
        </button>
      ) : step === 'choose' ? (
        <div className="report-choices">
          <div className="report-row">
            {hasTerrace ? (
              startPin && (
                <button type="button" onClick={() => startPin(venue)}>
                  Mover la terraza
                </button>
              )
            ) : (
              <button
                type="button"
                disabled={!token || sending}
                onClick={() => answer(true)}
              >
                Sí, tiene terraza
              </button>
            )}
            <button
              type="button"
              disabled={!token || sending}
              onClick={() => answer(false)}
            >
              No tiene terraza
            </button>
          </div>
          <div className="report-row">
            {startMove && (
              <button type="button" onClick={() => startMove(venue)}>
                Está en otro sitio
              </button>
            )}
            <button type="button" onClick={() => go('closed')}>
              Ya no existe
            </button>
          </div>
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            action="report"
            onToken={setToken}
          />
          {/* Focus lands on Volver: the answers wait for the bot check. */}
          <button
            type="button"
            className="report-link"
            onClick={back}
            data-focus
          >
            Volver
          </button>
        </div>
      ) : (
        <div className="report-choices">
          <p tabIndex={-1} data-focus>
            ¿Seguro que ha cerrado o ya no existe?
          </p>
          <Turnstile
            siteKey={TURNSTILE_SITE_KEY}
            action="report"
            onToken={setToken}
          />
          <div className="report-row">
            <button type="button" onClick={back}>
              Volver
            </button>
            <button
              type="button"
              className="report-send"
              disabled={!token || sending}
              onClick={() => {
                if (token) send({ kind: 'closed', venueId: venue.id, token })
              }}
            >
              {sending ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

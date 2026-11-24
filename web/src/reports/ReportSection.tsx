import { useContext, useEffect, useRef, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY, type SuggestResult } from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import { StartMoveContext } from './picking.ts'
import { CAN_REPORT, reportVenue, RESULT_TEXT } from './reports.ts'
import './reports.css'

type Step = 'idle' | 'choose' | 'closed'

/**
 * "¿Algo está mal?" on the venue card: report that the venue is somewhere
 * else (opens the map picker) or no longer exists (confirmed here).
 */
export function ReportSection({ venue }: { venue: Terrace }) {
  const startMove = useContext(StartMoveContext)
  const [step, setStep] = useState<Step>('idle')
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<SuggestResult | null>(null)

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

  const back = () => {
    go('idle')
    setToken(null)
  }

  return (
    <div className="report-section" ref={sectionRef}>
      {result ? (
        <p className="report-result" role="status" tabIndex={-1} data-focus>
          {RESULT_TEXT[result]}
        </p>
      ) : step === 'idle' ? (
        <button
          type="button"
          className="report-link"
          data-focus
          onClick={() => go('choose')}
        >
          ¿Algo está mal?
        </button>
      ) : step === 'choose' ? (
        <div className="report-choices">
          <div className="report-row">
            {startMove && (
              <button type="button" onClick={() => startMove(venue)} data-focus>
                Está en otro sitio
              </button>
            )}
            <button
              type="button"
              onClick={() => go('closed')}
              data-focus={startMove ? undefined : true}
            >
              Ya no existe
            </button>
          </div>
          <button type="button" className="report-link" onClick={back}>
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
                if (!token) return
                setSending(true)
                void reportVenue({ kind: 'closed', venueId: venue.id, token })
                  .then((sent) => {
                    moveFocus.current = true
                    setResult(sent)
                  })
                  .finally(() => setSending(false))
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

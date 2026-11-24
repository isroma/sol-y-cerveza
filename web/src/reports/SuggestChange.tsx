import { useContext, useEffect, useRef, useState } from 'react'
import {
  BRAND_NAMES,
  BRANDS,
  parseEuros,
  type Brand,
  type Item,
} from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import {
  PRICE_RESULT_TEXT,
  suggestPrice,
  TURNSTILE_SITE_KEY,
  type SuggestResult,
} from '../prices/crowd.ts'
import { Turnstile } from '../prices/Turnstile.tsx'
import { Toggle } from '../ui/Toggle.tsx'
import { StartMoveContext } from './picking.ts'
import { reportVenue, RESULT_TEXT } from './reports.ts'
import './reports.css'

const ITEMS: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

/** The API takes prices from 0,50 € to 8,00 €. */
const MIN_CENTS = 50
const MAX_CENTS = 800

/**
 * The back of the venue card: every change a visitor can suggest on one
 * card, sent with one Enviar. A beer price and "Ya no existe" go to their own
 * endpoints, each with its own bot check (a Turnstile token works once, for
 * one action). "Ubicación" hands over to the map picker.
 */
export function SuggestChange({
  venue,
  onBack,
}: {
  venue: Terrace
  onBack: () => void
}) {
  const startMove = useContext(StartMoveContext)
  const [item, setItem] = useState<Item>('cana')
  const [brand, setBrand] = useState<Brand>('cruzcampo')
  const [text, setText] = useState('')
  const [closed, setClosed] = useState(false)
  const [priceToken, setPriceToken] = useState<string | null>(null)
  const [reportToken, setReportToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // The card is a map marker: stop drags, scrolls and keys natively so they
  // don't pan or zoom the map. Clicks reach React; MapView ignores clicks on
  // the card.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = rootRef.current
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

  // Focus starts on the title (no ring on a tap), then the result.
  useEffect(() => {
    rootRef.current
      ?.querySelector<HTMLElement>('[data-focus]')
      ?.focus({ preventScroll: true })
  }, [result])

  const cents = parseEuros(text)
  const hasPrice = text.trim() !== ''
  const priceOk = cents !== null && cents >= MIN_CENTS && cents <= MAX_CENTS
  const ready =
    (hasPrice || closed) &&
    (!hasPrice || (priceOk && priceToken !== null)) &&
    (!closed || reportToken !== null)

  const send = async () => {
    if (!ready) return
    setSending(true)
    const price =
      hasPrice && cents !== null && priceToken
        ? suggestPrice({
            venueId: venue.id,
            item,
            brand: item === 'tercio' ? brand : null,
            cents,
            token: priceToken,
          })
        : null
    const report =
      closed && reportToken
        ? reportVenue({ kind: 'closed', venueId: venue.id, token: reportToken })
        : null
    const [priceResult, reportResult] = await Promise.all([price, report])
    setSending(false)
    setResult(summary(priceResult, reportResult))
  }

  return (
    <div className="change" ref={rootRef}>
      <div className="change-head">
        <button
          type="button"
          className="icon-button change-back"
          aria-label="Volver"
          title="Volver"
          onClick={onBack}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M15 5l-7 7 7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div
          className="change-title"
          tabIndex={-1}
          data-focus={result ? undefined : true}
        >
          <strong>Sugerir un cambio</strong>
          <span>{venue.name}</span>
        </div>
      </div>
      {result ? (
        <p className="change-result" role="status" tabIndex={-1} data-focus>
          {result}
        </p>
      ) : (
        <form
          className="change-form"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <div className="change-group">
            <div className="change-row change-row--segmented">
              <div
                className="price-segmented"
                role="radiogroup"
                aria-label="Bebida"
              >
                {(['cana', 'tercio'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={item === value}
                    onClick={() => setItem(value)}
                  >
                    {ITEMS[value]}
                  </button>
                ))}
              </div>
            </div>
            {item === 'tercio' && (
              <label className="change-row">
                <span>Marca</span>
                <select
                  className="change-select"
                  value={brand}
                  onChange={(e) => {
                    const picked = BRANDS.find((b) => b === e.target.value)
                    if (picked) setBrand(picked)
                  }}
                >
                  {BRANDS.map((b) => (
                    <option key={b} value={b}>
                      {BRAND_NAMES[b]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="change-row">
              <span>Precio</span>
              <span className="change-amount">
                <input
                  aria-label={`Precio ${item === 'cana' ? 'de la caña' : 'del tercio'} en euros`}
                  inputMode="decimal"
                  placeholder="—"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                />
                <span aria-hidden="true">€</span>
              </span>
            </label>
          </div>
          <div className="change-group">
            {startMove && (
              <button
                type="button"
                className="change-row change-link"
                onClick={() => startMove(venue)}
              >
                <span>Ubicación</span>
                <span className="change-hint">Mover en el mapa ›</span>
              </button>
            )}
            <label className="change-row">
              <span aria-hidden="true">Ya no existe</span>
              <Toggle
                checked={closed}
                onChange={setClosed}
                label="Ya no existe"
              />
            </label>
          </div>
          {hasPrice && !priceOk && (
            <p className="change-note">
              Escribe un precio entre 0,50 € y 8,00 €.
            </p>
          )}
          {TURNSTILE_SITE_KEY && hasPrice && (
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              action="suggest"
              onToken={setPriceToken}
            />
          )}
          {TURNSTILE_SITE_KEY && closed && (
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              action="report"
              onToken={setReportToken}
            />
          )}
          <button
            type="submit"
            className="change-send"
            disabled={!ready || sending}
          >
            {sending ? 'Enviando…' : 'Enviar'}
          </button>
        </form>
      )}
    </div>
  )
}

/** One line for what was sent: the first failure, else the thanks. */
function summary(
  price: SuggestResult | null,
  report: SuggestResult | null,
): string {
  if (report && report !== 'ok') return RESULT_TEXT[report]
  if (price && price !== 'ok') return PRICE_RESULT_TEXT[price]
  return report ? RESULT_TEXT.ok : PRICE_RESULT_TEXT.ok
}

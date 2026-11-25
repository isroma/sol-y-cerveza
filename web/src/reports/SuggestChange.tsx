import { useContext, useEffect, useRef, useState } from 'react'
import {
  BRAND_NAMES,
  BRANDS,
  formatCents,
  parseEuros,
  SUGGEST_RANGE,
  type Item,
} from '../data/prices.ts'
import { distanceMetres } from '../data/geo.ts'
import type { Terrace } from '../data/terraces.ts'
import { TURNSTILE_SITE_KEY } from '../apiClient.ts'
import { Turnstile } from './Turnstile.tsx'
import { Toggle } from '../ui/Toggle.tsx'
import { StartMoveContext } from './picking.ts'
import type { ChangeDraft } from './draft.ts'
import {
  OWNER_RESULT_TEXT,
  PRICE_RESULT_TEXT,
  RESULT_TEXT,
  sendChange,
  sendOwnerChange,
} from './reports.ts'
import { useOwner } from '../prices/owner.ts'
import { refreshCrowdPrices } from '../prices/crowd.ts'
import './reports.css'

const ITEMS: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

/** Turnstile tokens last 300 s; one older than this is dropped for a new check. */
const TOKEN_TTL_MS = 240_000

/**
 * The back of the venue card: every change a visitor can suggest on one
 * card (a beer price, a new location, "Ya no existe"), sent as one request
 * behind one bot check. The check runs as soon as the back opens (the
 * owner's call), so its token is usually ready by the first edit.
 * "Ubicación" hands over to the map picker, which brings the spot back here.
 * In owner mode the same form saves a change instead, with no bot check.
 */
export function SuggestChange({
  venue,
  draft,
  onChange,
  onBack,
}: {
  venue: Terrace
  /** What the visitor has filled in; App keeps it across the picker. */
  draft: ChangeDraft
  onChange: (patch: Partial<ChangeDraft>) => void
  onBack: () => void
}) {
  const startMove = useContext(StartMoveContext)
  const owner = useOwner().token !== null
  const { item, brand, text, closed, move } = draft
  // A token from before the trip to the map is used if still fresh.
  const [token, setToken] = useState(() =>
    draft.token !== null && Date.now() - draft.tokenAt < TOKEN_TTL_MS
      ? draft.token
      : null,
  )
  const keepToken = (fresh: string | null) => {
    setToken(fresh)
    onChange({ token: fresh, tokenAt: Date.now() })
  }
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
  // The range the API accepts for this item.
  const [minCents, maxCents] = SUGGEST_RANGE[item]
  const priceOk = cents !== null && cents >= minCents && cents <= maxCents
  const edited = hasPrice || closed || move !== null
  const ready = edited && (!hasPrice || priceOk) && (owner || token !== null)
  // How far from its badge the visitor placed it.
  const moved = move
    ? Math.round(distanceMetres(venue.terrace ?? venue.venue, move))
    : null

  const send = async () => {
    if (!ready) return
    const parts = {
      venueId: venue.id,
      ...(hasPrice && cents !== null
        ? {
            price: {
              item,
              brand: item === 'tercio' ? brand : null,
              cents,
            },
          }
        : {}),
      ...(move ? { move } : {}),
      ...(closed ? { closed: true as const } : {}),
    }
    const priceOnly = hasPrice && !closed && move === null
    if (owner) {
      setSending(true)
      const answer = await sendOwnerChange(parts)
      setSending(false)
      if (answer === 'ok' && hasPrice) void refreshCrowdPrices()
      // A price shows at once; a move or closure at the next Publish.
      setResult(
        answer !== 'ok'
          ? OWNER_RESULT_TEXT.error
          : priceOnly
            ? OWNER_RESULT_TEXT.price
            : OWNER_RESULT_TEXT.later,
      )
      return
    }
    if (token === null) return
    setSending(true)
    const answer = await sendChange({ ...parts, token })
    setSending(false)
    // A price alone waits for agreement; anything else for review.
    setResult((priceOnly ? PRICE_RESULT_TEXT : RESULT_TEXT)[answer])
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
          <strong>{owner ? 'Editar' : 'Sugerir un cambio'}</strong>
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
                    onClick={() => onChange({ item: value })}
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
                    if (picked) onChange({ brand: picked })
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
                  onChange={(e) => onChange({ text: e.target.value })}
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
                <span className="change-hint">
                  {moved === null
                    ? 'Mover en el mapa ›'
                    : `Movida ${moved} m ›`}
                </span>
              </button>
            )}
            <label className="change-row">
              <span aria-hidden="true">Ya no existe</span>
              <Toggle
                checked={closed}
                onChange={(on) => onChange({ closed: on })}
                label="Ya no existe"
              />
            </label>
          </div>
          {hasPrice && !priceOk && (
            <p className="change-note">
              {`Escribe un precio entre ${formatCents(minCents)} y ${formatCents(maxCents)}.`}
            </p>
          )}
          {TURNSTILE_SITE_KEY && !owner && (
            <Turnstile
              siteKey={TURNSTILE_SITE_KEY}
              action="change"
              run={token === null}
              onToken={keepToken}
            />
          )}
          <button
            type="submit"
            className="change-send"
            disabled={!ready || sending}
          >
            {owner
              ? sending
                ? 'Guardando…'
                : 'Guardar'
              : sending
                ? 'Enviando…'
                : 'Enviar'}
          </button>
        </form>
      )}
    </div>
  )
}

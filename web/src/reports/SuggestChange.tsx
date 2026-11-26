import {
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
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
import { sentParts, terraceOn, type ChangeDraft } from './draft.ts'
import {
  MIN_MOVE_M,
  OWNER_RESULT_TEXT,
  PRICE_RESULT_TEXT,
  RESULT_TEXT,
  SUN_RESULT_TEXT,
  sendChange,
  sendOwnerChange,
} from './reports.ts'
import { useOwner } from '../prices/owner.ts'
import { refreshCrowdPrices } from '../prices/crowd.ts'
import { refreshSunCorrections, useSunCorrections } from '../sun/corrections.ts'
import { canReportSun } from '../sun/reportable.ts'
import { track } from '../telemetry.ts'
import './reports.css'

const ITEMS: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

/** Turnstile tokens last 300 s; one older than this is dropped for a new check. */
const TOKEN_TTL_MS = 240_000

/**
 * Rows that fold open and shut. Shut, they are out of the tab order and
 * hidden from assistive tech (`inert`), not just zero high. `data-fold`
 * tells the map (pendingFolds in cardFit.ts) which ones change the card's
 * height, so it can fit the card to where it is going.
 */
function Fold({
  open,
  sideways = false,
  children,
}: {
  open: boolean
  /** Folds by its width (the tables' button), not the card's height. */
  sideways?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={open ? 'change-fold is-open' : 'change-fold'}
      data-fold={sideways ? 'x' : 'y'}
      inert={!open}
      aria-hidden={!open}
    >
      <div>{children}</div>
    </div>
  )
}

/**
 * The back of the venue card: every change a visitor can suggest on one
 * compact form (a beer price, whether it has a terrace, sun right now where
 * the app says shade, moving the bar or its tables, "Ya no existe"), sent as
 * one request behind one bot check. The check runs as soon as the back
 * opens (the owner's call), so its token is usually ready by the first edit.
 * "Mover el bar" and "Mover mesas" hand over to the map picker, which
 * brings the spot back here. "Ya no existe" folds the form away and goes alone; the
 * terrace switched off folds away the sun and the tables. What is folded
 * stays in the draft and is left out when sending (`sentParts`), so undoing
 * brings it back. In owner mode the same form saves a change instead, with
 * no bot check.
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
  // "Tiene terraza" starts where the data is (on where it has a terrace):
  // moving it is the suggestion, moving it back takes it back.
  const known = venue.terrace !== null
  const terrace = terraceOn(venue, draft)
  // "Ahora mismo da el sol" is about the real present, so it shows only
  // while the app says shade here now with the sun up (checked as the back
  // opens; the corrections can still change while it is open).
  const corrections = useSunCorrections()
  const [openedAt] = useState(() => new Date())
  const sunRow = useMemo(
    () => canReportSun(venue, corrections, openedAt),
    [venue, corrections, openedAt],
  )
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

  // What would go now: "Ya no existe" alone, nothing folded away.
  const parts = sentParts(venue, draft, sunRow)
  // A price typed (and not folded away), checked against the range the API
  // accepts for this item.
  const hasPrice = !closed && text.trim() !== ''
  const cents = parseEuros(text)
  const [minCents, maxCents] = SUGGEST_RANGE[item]
  const priceOk = cents !== null && cents >= minCents && cents <= maxCents
  const edited = hasPrice || Object.keys(parts).length > 0
  const ready = edited && (!hasPrice || priceOk) && (owner || token !== null)
  // How far from its badge the visitor placed it.
  const moved = move
    ? Math.round(distanceMetres(venue.terrace ?? venue.venue, move))
    : null
  // How far the tables are from the terrace's badge, or from the venue.
  const pinned = draft.pin
    ? Math.round(distanceMetres(venue.terrace ?? venue.venue, draft.pin))
    : null

  const send = async () => {
    if (!ready) return
    // Shown without review: a price and sun (on agreement, or at once for
    // the owner). A move, a closure or the terrace waits for review or Publish.
    const reviewed =
      parts.closed !== undefined ||
      parts.move !== undefined ||
      parts.terrace !== undefined ||
      parts.pin !== undefined
    const withPrice = parts.price !== undefined
    const withSun = parts.sun !== undefined
    const priceOnly = withPrice && !reviewed && !withSun
    const sunOnly = withSun && !reviewed && !withPrice
    if (owner) {
      setSending(true)
      const answer = await sendOwnerChange({ venueId: venue.id, ...parts })
      setSending(false)
      if (answer === 'ok' && withPrice) void refreshCrowdPrices()
      if (answer === 'ok' && withSun) void refreshSunCorrections()
      // A price or sun shows at once; a move, closure or terrace at the next
      // Publish.
      setResult(
        answer !== 'ok'
          ? OWNER_RESULT_TEXT.error
          : reviewed
            ? OWNER_RESULT_TEXT.later
            : priceOnly
              ? OWNER_RESULT_TEXT.price
              : sunOnly
                ? OWNER_RESULT_TEXT.sun
                : OWNER_RESULT_TEXT.now,
      )
      return
    }
    if (token === null) return
    setSending(true)
    const answer = await sendChange({ venueId: venue.id, ...parts, token })
    setSending(false)
    if (answer === 'ok') track('suggest_sent')
    if (answer === 'ok' && withSun) track('sun_report')
    // A price or sun waits for agreement; a move, closure or terrace for review.
    setResult(
      (reviewed ? RESULT_TEXT : sunOnly ? SUN_RESULT_TEXT : PRICE_RESULT_TEXT)[
        answer
      ],
    )
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
          {/* The form, or in its place the closure's one line: one fold
              shuts as the other opens, on the same curve. */}
          <div className="change-swap">
            <Fold open={!closed}>
              <div className="change-group">
                <div className="change-row change-row--price">
                  <div
                    className="price-segmented change-item"
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
                </div>
                <Fold open={item === 'tercio'}>
                  <label className="change-brand">
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
                </Fold>
                <label className="change-row">
                  <span aria-hidden="true">Tiene terraza</span>
                  <Toggle
                    checked={terrace}
                    // Back where the data is: nothing to say.
                    onChange={(on) =>
                      onChange({ terrace: on === known ? null : on })
                    }
                    label="Tiene terraza"
                  />
                </label>
                {sunRow && (
                  <Fold open={terrace}>
                    <label className="change-row">
                      <span aria-hidden="true">Ahora mismo da el sol</span>
                      <Toggle
                        checked={draft.sun}
                        onChange={(on) => onChange({ sun: on })}
                        label="Ahora mismo da el sol"
                      />
                    </label>
                  </Fold>
                )}
                {startMove && (
                  <div
                    className="change-row change-row--move"
                    role="group"
                    aria-label="Mover"
                  >
                    <button
                      type="button"
                      className={
                        moved === null ? 'change-pill' : 'change-pill is-set'
                      }
                      onClick={() => startMove(venue)}
                    >
                      {moved === null ? 'Mover el bar' : `Bar · ${moved} m`}
                    </button>
                    <Fold open={terrace} sideways>
                      <button
                        type="button"
                        className={
                          pinned === null ? 'change-pill' : 'change-pill is-set'
                        }
                        onClick={() => startMove(venue, 'pin')}
                      >
                        {pinned === null
                          ? 'Mover mesas'
                          : !known && pinned <= MIN_MOVE_M
                            ? // Where the picker said "justo aquí".
                              'Mesas · aquí'
                            : `Mesas · ${pinned} m`}
                      </button>
                    </Fold>
                  </div>
                )}
              </div>
              {hasPrice && !priceOk && (
                <p className="change-note">
                  {`Escribe un precio entre ${formatCents(minCents)} y ${formatCents(maxCents)}.`}
                </p>
              )}
            </Fold>
            <Fold open={closed}>
              <p className="change-closed">
                Avisaremos de que este bar ha cerrado. No hace falta nada más.
              </p>
            </Fold>
          </div>
          <button
            type="button"
            className="change-flag"
            aria-pressed={closed}
            onClick={() => onChange({ closed: !closed })}
          >
            Ya no existe
          </button>
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

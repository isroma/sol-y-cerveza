import { useEffect, useRef, useState } from 'react'
import {
  BRAND_NAMES,
  BRANDS,
  formatCents,
  parseEuros,
  type Brand,
  type Item,
} from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import {
  PRICES_API,
  shownPrices,
  suggestPrice,
  TURNSTILE_SITE_KEY,
  useCrowdPrices,
  type SuggestResult,
} from './crowd.ts'
import { BeerIcon } from '../ui/icons.tsx'
import { useOwner } from './owner.ts'
import { OwnerPrices } from './OwnerPrices.tsx'
import { Turnstile } from './Turnstile.tsx'
import './prices.css'

const LABEL: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

const RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
  'rate-limited':
    'Hay demasiados precios enviados desde tu conexión o para este bar. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

function SuggestForm({
  venueId,
  siteKey,
  onDone,
  onCancel,
}: {
  venueId: string
  siteKey: string
  onDone: (result: SuggestResult) => void
  onCancel: () => void
}) {
  const [item, setItem] = useState<Item>('cana')
  const [brand, setBrand] = useState<Brand>('cruzcampo')
  const [text, setText] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const cents = parseEuros(text)
  const valid = cents !== null && cents >= 50 && cents <= 800

  return (
    <form
      className="price-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (!valid || !token || cents === null) return
        setSending(true)
        void suggestPrice({
          venueId,
          item,
          brand: item === 'tercio' ? brand : null,
          cents,
          token,
        }).then(onDone)
      }}
    >
      <div className="price-segmented" role="radiogroup" aria-label="Bebida">
        {(['cana', 'tercio'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={item === value}
            onClick={() => setItem(value)}
          >
            {LABEL[value]}
          </button>
        ))}
      </div>
      <div className="price-fields">
        {item === 'tercio' && (
          <select
            className="price-field"
            aria-label="Marca"
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
        )}
        <label className="price-field price-amount">
          <input
            aria-label="Precio en euros"
            inputMode="decimal"
            placeholder="1,50"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <span aria-hidden="true">€</span>
        </label>
      </div>
      <Turnstile siteKey={siteKey} onToken={setToken} />
      <div className="price-actions">
        <button type="button" className="price-cancel" onClick={onCancel}>
          Cancelar
        </button>
        <button
          type="submit"
          className="price-send"
          disabled={!valid || !token || sending}
        >
          {sending ? 'Enviando…' : 'Enviar precio'}
        </button>
      </div>
    </form>
  )
}

/** Beer prices on the venue card, and a way for visitors to suggest one. */
export function PriceSection({ venue }: { venue: Terrace }) {
  const crowd = useCrowdPrices()
  const { token } = useOwner()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<SuggestResult | null>(null)

  // The card is a map marker: the map's own listeners see events before
  // React does, so stop drags, scrolls and keys natively, or they would pan or
  // zoom the map. Clicks must reach React; MapView ignores clicks on the card.
  const sectionRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = sectionRef.current
    if (!element) return
    const stop = (event: Event) => {
      event.stopPropagation()
      // Stopped here, keys never reach React's handlers: Enter in a price
      // box leaves the field, which saves it.
      if (
        event instanceof KeyboardEvent &&
        event.key === 'Enter' &&
        event.target instanceof HTMLInputElement
      )
        event.target.blur()
    }
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

  const prices = shownPrices(venue.id, venue.prices ?? [], crowd)
  const canSuggest = PRICES_API !== null && TURNSTILE_SITE_KEY !== null
  if (prices.length === 0 && !canSuggest && !token) return null

  return (
    <div className="price-section" ref={sectionRef}>
      {token ? (
        <OwnerPrices venue={venue} prices={prices} />
      ) : (
        <>
          <div className="price-row">
            <span className="price-badge" aria-hidden="true">
              <BeerIcon size={30} />
            </span>
            {prices.length > 0 ? (
              <ul className="price-list">
                {prices.map((p) => (
                  <li key={`${p.item}-${p.brand ?? ''}`}>
                    <span>
                      {LABEL[p.item]}
                      {p.brand && ` ${BRAND_NAMES[p.brand]}`}
                    </span>
                    <strong
                      title={
                        p.approximate
                          ? 'Precio aproximado: varias personas lo han indicado'
                          : undefined
                      }
                    >
                      {p.approximate && '~'}
                      {formatCents(p.cents)}
                    </strong>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="price-empty">
                <strong>Caña</strong>
                <span>Sin precio aún</span>
              </div>
            )}
            {canSuggest && !open && !result && (
              <button
                type="button"
                className="price-suggest"
                onClick={() => setOpen(true)}
              >
                {prices.length > 0 ? 'Corregir' : 'Sugerir'}
              </button>
            )}
          </div>
          {canSuggest && TURNSTILE_SITE_KEY && (
            <>
              {result ? (
                <p
                  className={`price-result${result === 'ok' ? ' is-ok' : ''}`}
                  role="status"
                >
                  {RESULT_TEXT[result]}
                </p>
              ) : (
                open && (
                  <SuggestForm
                    venueId={venue.id}
                    siteKey={TURNSTILE_SITE_KEY}
                    onDone={setResult}
                    onCancel={() => setOpen(false)}
                  />
                )
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

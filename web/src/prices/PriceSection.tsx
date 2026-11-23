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
import { useOwner } from './owner.ts'
import { OwnerPrices } from './OwnerPrices.tsx'
import { Turnstile } from './Turnstile.tsx'
import './prices.css'

const LABEL: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

const RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
  'rate-limited': 'Has enviado muchos precios hoy. Prueba mañana.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

function SuggestForm({
  venueId,
  siteKey,
  onDone,
}: {
  venueId: string
  siteKey: string
  onDone: (result: SuggestResult) => void
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
      <div className="price-form-row">
        <select
          aria-label="Bebida"
          value={item}
          onChange={(e) =>
            setItem(e.target.value === 'tercio' ? 'tercio' : 'cana')
          }
        >
          <option value="cana">Caña</option>
          <option value="tercio">Tercio</option>
        </select>
        {item === 'tercio' && (
          <select
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
        <input
          aria-label="Precio en euros"
          inputMode="decimal"
          placeholder="1,50"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <span>€</span>
      </div>
      <Turnstile siteKey={siteKey} onToken={setToken} />
      <button type="submit" disabled={!valid || !token || sending}>
        {sending ? 'Enviando…' : 'Enviar precio'}
      </button>
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
            <p className="price-empty">Aún no sabemos cuánto cuesta la caña.</p>
          )}
          {canSuggest && TURNSTILE_SITE_KEY && (
            <>
              {result ? (
                <p className="price-result">{RESULT_TEXT[result]}</p>
              ) : open ? (
                <SuggestForm
                  venueId={venue.id}
                  siteKey={TURNSTILE_SITE_KEY}
                  onDone={setResult}
                />
              ) : (
                <button
                  type="button"
                  className="price-suggest"
                  onClick={() => setOpen(true)}
                >
                  ¿Sabes el precio? Sugiérelo
                </button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

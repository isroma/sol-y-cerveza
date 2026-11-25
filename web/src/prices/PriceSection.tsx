import { useEffect, useId, useRef, useState } from 'react'
import { BRAND_NAMES, formatCents, type Item } from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import { shownPrices, useCrowdPrices, type ShownPrice } from './crowd.ts'
import { CanaIcon, TercioIcon } from '../ui/icons.tsx'
import './prices.css'

const HINTS = {
  both: 'Toca caña o tercio para ver los detalles',
  cana: 'Toca la caña para ver los detalles',
  tercio: 'Toca el tercio para ver los detalles',
}

/** "25 nov", in Badajoz time. */
function shortDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Europe/Madrid',
    })
    .replace('.', '')
}

/** The price on the tercio pill: exact, or "~" and the middle one when brands differ. */
function tercioPillPrice(tercios: readonly ShownPrice[]): string {
  const cents = tercios.map((p) => p.cents).sort((a, b) => a - b)
  const first = cents[0] ?? 0
  if (cents.every((c) => c === first)) return formatCents(first)
  const middle = cents[Math.floor((cents.length - 1) / 2)] ?? first
  return `~${formatCents(middle)}`
}

function Updated({ prices }: { prices: readonly ShownPrice[] }) {
  const latest = prices
    .map((p) => p.updated)
    .sort()
    .at(-1)
  if (!latest) return null
  return (
    <p className="price-updated">
      Actualizado en Sol y Cerveza el {shortDate(latest)}
    </p>
  )
}

function Details({ item, prices }: { item: Item; prices: ShownPrice[] }) {
  const shown = prices.filter((p) => p.item === item)
  const [single] = shown
  if (shown.length > 1)
    return (
      <>
        <strong className="price-more-title">Tercios</strong>
        <ul className="price-brands">
          {shown.map((p) => (
            <li key={p.brand ?? ''}>
              <span>{p.brand ? BRAND_NAMES[p.brand] : 'Tercio'}</span>
              <strong>{formatCents(p.cents)}</strong>
            </li>
          ))}
        </ul>
        <Updated prices={shown} />
      </>
    )
  if (!single) return null
  const name = item === 'cana' ? 'Caña' : 'Tercio'
  return (
    <>
      <div className="price-more-row">
        <strong>
          {single.brand ? `${name} de ${BRAND_NAMES[single.brand]}` : name}
        </strong>
        <strong>{formatCents(single.cents)}</strong>
      </div>
      <Updated prices={shown} />
    </>
  )
}

/**
 * Beer prices on the venue card: a caña pill and a tercio pill; tapping one
 * opens its details (brand, every tercio brand, when it was updated) under
 * them. Visitors suggest prices, and the owner changes them, from the card's
 * back (SuggestChange).
 */
export function PriceSection({ venue }: { venue: Terrace }) {
  const crowd = useCrowdPrices()
  const detailsId = useId()
  // The open pill, and the last one opened: its details stay in place while
  // they fold away.
  const [open, setOpen] = useState<Item | null>(null)
  const [last, setLast] = useState<Item | null>(null)

  // The card is a map marker: the map's own listeners see events before
  // React does, so stop drags, scrolls and keys natively, or they would pan or
  // zoom the map. Clicks must reach React; MapView ignores clicks on the card.
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

  const prices = shownPrices(venue.id, venue.prices ?? [], crowd)
  const cana = prices.find((p) => p.item === 'cana')
  const tercios = prices.filter((p) => p.item === 'tercio')
  if (!cana && tercios.length === 0) return null

  const toggle = (item: Item) => {
    setLast(item)
    setOpen(open === item ? null : item)
  }
  const pill = (item: Item, label: string, price: string) => (
    <button
      type="button"
      className="price-pill"
      aria-expanded={open === item}
      aria-controls={detailsId}
      onClick={() => toggle(item)}
    >
      {item === 'cana' ? <CanaIcon size={16} /> : <TercioIcon size={16} />}
      {label} <strong>{price}</strong>
    </button>
  )

  return (
    <div className="price-section" ref={sectionRef}>
      <div className="price-pills" role="group" aria-label="Precios">
        {cana && pill('cana', 'Caña', formatCents(cana.cents))}
        {tercios.length > 0 &&
          pill('tercio', 'Tercio', tercioPillPrice(tercios))}
      </div>
      <div className={open ? 'price-fold' : 'price-fold is-open'}>
        <div>
          <p className="price-hint">
            {
              HINTS[
                cana && tercios.length > 0 ? 'both' : cana ? 'cana' : 'tercio'
              ]
            }
          </p>
        </div>
      </div>
      <div
        id={detailsId}
        className={open ? 'price-fold is-open' : 'price-fold'}
        aria-hidden={!open}
      >
        <div className="price-more">
          {/* Switching pills fades the new details in, without refolding. */}
          <div key={last} className="price-more-body">
            {last && <Details item={last} prices={prices} />}
          </div>
        </div>
      </div>
    </div>
  )
}

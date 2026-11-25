import { useEffect, useRef } from 'react'
import { BRAND_NAMES, formatCents, type Item } from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import { shownPrices, useCrowdPrices } from './crowd.ts'
import { BeerIcon } from '../ui/icons.tsx'
import './prices.css'

const LABEL: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

/**
 * Beer prices on the venue card, as one compact line. Visitors suggest prices,
 * and the owner changes them, from the card's back (SuggestChange).
 */
export function PriceSection({ venue }: { venue: Terrace }) {
  const crowd = useCrowdPrices()

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
  if (prices.length === 0) return null

  return (
    <div className="price-section" ref={sectionRef}>
      <ul className="price-inline" aria-label="Precios">
        <li className="price-badge" aria-hidden="true">
          <BeerIcon size={18} />
        </li>
        {prices.map((p) => (
          <li key={`${p.item}-${p.brand ?? ''}`}>
            {LABEL[p.item]}
            {p.brand && ` ${BRAND_NAMES[p.brand]}`}{' '}
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
    </div>
  )
}

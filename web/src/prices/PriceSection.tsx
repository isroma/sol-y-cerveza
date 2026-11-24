import { useEffect, useRef } from 'react'
import { BRAND_NAMES, formatCents, type Item } from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import { shownPrices, useCrowdPrices } from './crowd.ts'
import { BeerIcon } from '../ui/icons.tsx'
import { useOwner } from './owner.ts'
import { OwnerPrices } from './OwnerPrices.tsx'
import './prices.css'

const LABEL: Record<Item, string> = { cana: 'Caña', tercio: 'Tercio' }

/**
 * Beer prices on the venue card, as one compact line (the owner edits them
 * here). Visitors suggest prices from the card's back (SuggestChange).
 */
export function PriceSection({ venue }: { venue: Terrace }) {
  const crowd = useCrowdPrices()
  const { token } = useOwner()

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
  if (!token && prices.length === 0) return null

  return (
    <div className="price-section" ref={sectionRef}>
      {token ? (
        <OwnerPrices venue={venue} prices={prices} />
      ) : (
        prices.length > 0 && (
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
        )
      )}
    </div>
  )
}

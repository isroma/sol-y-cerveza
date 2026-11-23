import type { VenueStatus } from '../sun/venueStatus.ts'
import { categoryLabel } from '../ui/categoryStyle.ts'

/** Shown where the caña price goes until real prices exist (#8). */
export const PRICE_PLACEHOLDER = '–,–– €'

const BEER_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 11h1.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H16"/><path d="M6 8c0-2 1.5-3 3-2.5C9.7 4 12 3.7 13 5c1.5-.7 3 .4 3 3"/><path d="M9.5 12v6M12.5 12v6"/></svg>'

/** A terrace pin like the design: sun-coloured beer badge plus the caña price. */
export function createPin(onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  // MapLibre positions markers with `transform` on this element, so the visual
  // pin (which scales when selected) is an inner element.
  el.className = 'pin-marker'
  el.innerHTML = `<span class="pin"><span class="pin-icon">${BEER_SVG}</span><span class="pin-price pin-price--unknown"></span></span>`
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  return el
}

export function updatePin(
  el: HTMLButtonElement,
  status: VenueStatus,
  selected: boolean,
): void {
  const pin = el.querySelector('.pin')
  if (pin)
    pin.className = `pin pin--${status.category}${selected ? ' pin--selected' : ''}`
  el.setAttribute(
    'aria-label',
    `${status.venue.name}: ${categoryLabel(status)}, precio de la caña aún sin datos`,
  )
  el.setAttribute('aria-pressed', String(selected))
  const priceEl = el.querySelector('.pin-price')
  if (priceEl) priceEl.textContent = PRICE_PLACEHOLDER
}

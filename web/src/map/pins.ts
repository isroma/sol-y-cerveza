import type { VenueStatus } from '../sun/venueStatus.ts'
import { categoryLabel } from '../ui/categoryStyle.ts'
import { badgePriceText, type BadgePrice } from './badgePrices.ts'

const BEER_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8h10v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 11h1.5a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H16"/><path d="M6 8c0-2 1.5-3 3-2.5C9.7 4 12 3.7 13 5c1.5-.7 3 .4 3 3"/><path d="M9.5 12v6M12.5 12v6"/></svg>'

/**
 * How far a badge's price tab reaches right of the badge's centre at full
 * size, in px: the tab starts at the centre, with 26 px before the price and
 * 13 px after it (pins.css). The price is measured where the badge already
 * shows it (its layout width, before the badge's scale); a new badge, not yet
 * on the page, is estimated from the number of characters.
 */
export function priceTabReach(
  el: HTMLElement | undefined,
  text: string,
): number {
  const shown = el?.querySelector<HTMLElement>('.pin-price-text')
  const width =
    shown && shown.textContent === text && shown.offsetWidth > 0
      ? shown.offsetWidth
      : text.length * 8
  return 26 + width + 13
}

/** Grey badges (no sun, unknown) are drawn at 78 % (pins.css). */
export function badgeScale(status: VenueStatus): number {
  return status.category === 'nosun' || status.category === 'unknown' ? 0.78 : 1
}

/** How close two badges' centres must be, in badge widths, to count as one cluster. */
const CLUSTER = 0.75

/**
 * The badge a mouse over `el` opens: `el` itself, unless a badge drawn in
 * front of it (higher z-index, or later on the page at the same z-index)
 * overlaps it, as in a cluster: then the frontmost of those. So pointing at a
 * badge peeking out from behind opens the one in front, the one the map
 * already put first.
 */
export function frontPin(el: HTMLElement): HTMLElement {
  const parent = el.parentElement
  const pinOf = (m: Element) => m.querySelector('.pin')?.getBoundingClientRect()
  const own = pinOf(el)
  if (!parent || !own) return el
  const centre = (r: DOMRect) => ({
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
  })
  const at = centre(own)
  const markers = [
    ...parent.querySelectorAll<HTMLElement>(':scope > .pin-marker'),
  ]
  const rank = (m: HTMLElement) => ({
    z: Number(m.style.zIndex) || 0,
    order: markers.indexOf(m),
  })
  let front = el
  for (const m of markers) {
    if (m === el) continue
    const r = pinOf(m)
    if (!r) continue
    const c = centre(r)
    const reach = CLUSTER * Math.max(own.width, r.width)
    if (Math.hypot(c.x - at.x, c.y - at.y) >= reach) continue
    const mine = rank(m)
    const best = rank(front)
    if (mine.z > best.z || (mine.z === best.z && mine.order > best.order))
      front = m
  }
  return front
}

/** A terrace pin like the design: a sun-coloured beer badge, with the caña price when it is shown (badgePrices.ts). */
export function createPin(
  onClick: () => void,
  /**
   * A mouse pointer comes onto the badge (true) or leaves it (false), with
   * the badge that opens for it (frontPin), which carries
   * `pin-marker--hovered` meanwhile (pins.css).
   */
  onHover?: (target: HTMLElement, hovered: boolean) => void,
): HTMLButtonElement {
  const el = document.createElement('button')
  el.type = 'button'
  // MapLibre positions markers with `transform` on this element, so the visual
  // pin (which scales when selected) is an inner element.
  el.className = 'pin-marker'
  // The tab holds the price and, under it, the name: hovered with a mouse,
  // the price rolls up and the name rolls in (pins.css).
  el.innerHTML = `<span class="pin"><span class="pin-icon">${BEER_SVG}</span><span class="pin-price"><span class="pin-swap"><span class="pin-price-text"></span><span class="pin-name" aria-hidden="true"><span></span></span></span></span></span>`
  el.addEventListener('click', (event) => {
    event.stopPropagation()
    onClick()
  })
  let target: HTMLElement | null = null
  el.addEventListener('pointerenter', (event) => {
    if (event.pointerType !== 'mouse') return
    target = frontPin(el)
    target.classList.add('pin-marker--hovered')
    onHover?.(target, true)
  })
  el.addEventListener('pointerleave', (event) => {
    if (event.pointerType !== 'mouse' || !target) return
    target.classList.remove('pin-marker--hovered')
    onHover?.(target, false)
    target = null
  })
  return el
}

export function updatePin(
  el: HTMLButtonElement,
  status: VenueStatus,
  selected: boolean,
  /** The venue's caña price, or null: kept in the badge so it can fade. */
  price: BadgePrice | null = null,
  /** Whether the price shows now (not selected, not crowded out). */
  showPrice = false,
): void {
  const shown = showPrice && price !== null
  const pin = el.querySelector('.pin')
  if (pin)
    pin.className = `pin pin--${status.category}${selected ? ' pin--selected' : ''}${shown ? ' pin--priced' : ''}`
  const text = price ? badgePriceText(price) : ''
  el.setAttribute(
    'aria-label',
    `${status.venue.name}: ${categoryLabel(status)}${shown ? `, caña ${text}` : ''}`,
  )
  el.setAttribute('aria-pressed', String(selected))
  const priceEl = el.querySelector('.pin-price-text')
  if (priceEl && priceEl.textContent !== text) priceEl.textContent = text
  const nameEl = el.querySelector('.pin-name > span')
  if (nameEl && nameEl.textContent !== status.venue.name)
    nameEl.textContent = status.venue.name
}

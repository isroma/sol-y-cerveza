import type { LngLat, Map as MapLibreMap } from 'maplibre-gl'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { cardScale, pitchForZoom } from './camera.ts'

/** Size the venue card for a zoom (see cardScale). */
export function sizeCard(el: HTMLElement, zoom: number) {
  el.style.setProperty('--card-scale', String(cardScale(zoom)))
}

export const FIT_MARGIN = 16
export const FIT_GAP = 8

/** The map as fitCard uses it; the rest is only needed with an anchor. */
export type FitMap = Pick<MapLibreMap, 'panBy'> &
  Partial<Pick<MapLibreMap, 'project' | 'unproject' | 'getCenter' | 'easeTo'>>

/** How a pan runs: by default 0.3 s on MapLibre's own curve. */
export type PanMotion = { duration: number; easing?: (t: number) => number }

/** A CSS cubic-bezier timing function as a function of progress. */
export function cubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (t: number) => number {
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3
  return (t) => {
    if (t <= 0 || t >= 1) return t <= 0 ? 0 : 1
    // x(s) rises monotonically for x1, x2 in [0, 1]: bisect for s.
    let lo = 0
    let hi = 1
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (at(x1, x2, mid) < t) lo = mid
      else hi = mid
    }
    return at(y1, y2, (lo + hi) / 2)
  }
}

const KEYWORDS: Record<string, [number, number, number, number]> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
  linear: [0, 0, 1, 1],
}

/** A computed `transition-timing-function` entry, or null if unknown. */
export function parseTiming(css: string): ((t: number) => number) | null {
  const named = KEYWORDS[css.trim()]
  if (named) return cubicBezier(...named)
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(css.trim())
  const values = match?.[1]?.split(',').map(Number) ?? []
  const [a, b, c, d] = values
  if (
    values.length !== 4 ||
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    values.some((v) => !Number.isFinite(v))
  )
    return null
  return cubicBezier(a, b, c, d)
}

/**
 * The card back's rows that are folding open or shut (`data-fold="y"`,
 * SuggestChange): how much taller (or shorter) the card is about to get, in
 * screen pixels, and the motion of the biggest change, so a pan can run
 * with it. Rows inside a shut fold are left out; the one around them counts
 * them. Read as a fold starts (its class changes): the sizes it reads are
 * exact then, before any frame of the transition.
 */
export function pendingFolds(card: HTMLElement): {
  delta: number
  motion: PanMotion | null
} {
  const scale = Number(card.style.getPropertyValue('--card-scale')) || 1
  let delta = 0
  let biggest = 0
  let changing: HTMLElement | null = null
  for (const fold of card.querySelectorAll<HTMLElement>('[data-fold="y"]')) {
    if (fold.parentElement?.closest('[data-fold]:not(.is-open)')) continue
    const inner = fold.firstElementChild
    if (!inner) continue
    const now = inner.getBoundingClientRect().height
    const end = fold.classList.contains('is-open')
      ? inner.scrollHeight * scale
      : 0
    const change = end - now
    if (Math.abs(change) < 0.5) continue
    delta += change
    if (Math.abs(change) > biggest) {
      biggest = Math.abs(change)
      changing = fold
    }
  }
  if (!changing) return { delta, motion: null }
  const style = getComputedStyle(changing)
  const properties = style.transitionProperty.split(',').map((p) => p.trim())
  const at = Math.max(0, properties.indexOf('grid-template-rows'))
  const durations = style.transitionDuration.split(',')
  // Timing functions hold commas themselves: split between entries only.
  const timings = style.transitionTimingFunction.split(/,(?![^(]*\))/)
  const seconds = Number.parseFloat(
    durations[at % durations.length] ?? durations[0] ?? '0',
  )
  const easing = parseTiming(timings[at % timings.length] ?? '')
  if (!(seconds > 0) || !easing) return { delta, motion: null }
  return { delta, motion: { duration: seconds * 1000, easing } }
}

/**
 * Pan so the open card sits fully inside the map and clear of the floating
 * controls (city, buttons, legend). A card too tall for the space below the
 * side buttons moves sideways past them, if it fits, to use the full height.
 * If it is still taller than the free space, cap its height (`--card-max`)
 * so the card body scrolls instead.
 */
export function fitCard(
  map: FitMap,
  card: HTMLElement,
  wrap: HTMLElement,
  {
    grow = 0,
    motion = { duration: 300 },
    anchor,
  }: {
    /** How much the card is about to grow (rows folding; see pendingFolds). */
    grow?: number
    /** The pan's motion: a fold's, so the card's edge and the map move as one. */
    motion?: PanMotion
    /**
     * Where the card is pinned on the map. With it, the pan moves that point
     * by exactly the pixels wanted, even on a tilted map, where a plain
     * panBy moves points away from the centre by more or less.
     */
    anchor?: LngLat
  } = {},
) {
  const box = wrap.getBoundingClientRect()
  const cardRect = card.querySelector('.pin-card')?.getBoundingClientRect()
  if (!cardRect || cardRect.width === 0) return
  const controls = [
    ...wrap.querySelectorAll('.map-city, .map-buttons, .map-legend'),
  ].map((el) => el.getBoundingClientRect())

  // The free band for the card's column, moved `shift` px sideways.
  const space = (shift: number) => {
    let top = box.top + FIT_MARGIN
    let bottom = box.bottom - FIT_MARGIN
    for (const r of controls) {
      if (
        r.width === 0 ||
        r.right <= cardRect.left + shift ||
        r.left >= cardRect.right + shift
      )
        continue
      if (r.top + r.height / 2 < box.top + box.height / 2)
        top = Math.max(top, r.bottom + FIT_GAP)
      else bottom = Math.min(bottom, r.top - FIT_GAP)
    }
    return { top, bottom }
  }

  // The card's full height, even while its body is capped and scrolling,
  // and once its folding rows have finished.
  const body = card.querySelector('.pin-card-body')
  const natural =
    (body
      ? cardRect.height - body.clientHeight + body.scrollHeight
      : cardRect.height) + grow
  let shift = 0
  let { top, bottom } = space(0)
  if (natural > bottom - top) {
    for (const r of controls) {
      const past =
        r.left > box.left + box.width / 2
          ? r.left - FIT_GAP - cardRect.right
          : r.right + FIT_GAP - cardRect.left
      if (
        past === 0 ||
        cardRect.left + past < box.left + FIT_MARGIN ||
        cardRect.right + past > box.right - FIT_MARGIN
      )
        continue
      const moved = space(past)
      if (moved.bottom - moved.top > bottom - top) {
        shift = past
        top = moved.top
        bottom = moved.bottom
      }
    }
  }

  const scale = Number(card.style.getPropertyValue('--card-scale')) || 1
  card.style.setProperty('--card-max', `${(bottom - top) / scale}px`)
  const fresh =
    card.querySelector('.pin-card')?.getBoundingClientRect() ?? cardRect
  const left = box.left + FIT_MARGIN
  const right = box.right - FIT_MARGIN
  // Panning by +x moves the map, and the card on it, x px to the left.
  const dx = shift
    ? -shift
    : fresh.left < left
      ? fresh.left - left
      : fresh.right > right
        ? fresh.right - right
        : 0
  const dy =
    fresh.top < top || natural > bottom - top
      ? fresh.top - top
      : fresh.top + natural > bottom
        ? fresh.top + natural - bottom
        : 0
  if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) return
  if (anchor && map.project && map.unproject && map.getCenter && map.easeTo) {
    // Move the camera over the ground by what takes the anchor from where it
    // is to where it should be on screen.
    const at = map.project(anchor)
    const there = map.unproject([at.x - dx, at.y - dy])
    const center = map.getCenter()
    map.easeTo({
      center: [
        center.lng + anchor.lng - there.lng,
        center.lat + anchor.lat - there.lat,
      ],
      ...motion,
    })
    return
  }
  map.panBy([dx, dy], motion)
}

/** Bring a venue into view, close enough for its full card. */
export function focusVenue(
  map: Pick<MapLibreMap, 'getZoom' | 'easeTo'>,
  status: VenueStatus,
) {
  const position = status.venue.terrace ?? status.venue.venue
  const zoom = Math.max(map.getZoom(), 16.5)
  map.easeTo({
    center: [position.lon, position.lat],
    zoom,
    pitch: pitchForZoom(zoom),
    // Venue a bit above centre, so the card below its badge fits in view.
    offset: [0, -120],
    duration: 900,
  })
}

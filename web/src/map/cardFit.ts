import type { Map as MapLibreMap } from 'maplibre-gl'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { cardScale, pitchForZoom } from './camera.ts'

/** Size the venue card for a zoom (see cardScale). */
export function sizeCard(el: HTMLElement, zoom: number) {
  el.style.setProperty('--card-scale', String(cardScale(zoom)))
}

export const FIT_MARGIN = 16
export const FIT_GAP = 8

/**
 * Pan so the open card sits fully inside the map and clear of the floating
 * controls (city, buttons, legend). A card too tall for the space below the
 * side buttons moves sideways past them, if it fits, to use the full height.
 * If it is still taller than the free space, cap its height (`--card-max`)
 * so the card body scrolls instead.
 */
export function fitCard(
  map: Pick<MapLibreMap, 'panBy'>,
  card: HTMLElement,
  wrap: HTMLElement,
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

  // The card's full height, even while its body is capped and scrolling.
  const body = card.querySelector('.pin-card-body')
  const natural = body
    ? cardRect.height - body.clientHeight + body.scrollHeight
    : cardRect.height
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
    fresh.top < top || fresh.height > bottom - top
      ? fresh.top - top
      : fresh.bottom > bottom
        ? fresh.bottom - bottom
        : 0
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
    map.panBy([dx, dy], { duration: 300 })
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

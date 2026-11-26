import { describe, expect, it, vi } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { createPin, frontPin, updatePin } from './pins.ts'

const status: VenueStatus = {
  venue: {
    id: 'osm:node/1',
    name: 'Cerveceria El Pilar',
    kind: 'bar',
    venue: { lat: 38.88, lon: -6.97 },
    terrace: { lat: 38.88, lon: -6.97 },
    sources: ['osm'],
    verified: null,
    horizon: null,
  },
  hasTerrace: true,
  state: 'sun',
  category: 'sun',
  timeline: null,
  approximate: null,
  byVisitors: false,
  sunUntil: null,
  nextSun: null,
  minutesLeft: null,
}

function pointer(type: string, pointerType: string): Event {
  const event = new Event(type)
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  return event
}

describe('pins', () => {
  it('keeps the price and, for hover, the name in the tab', () => {
    const el = createPin(() => {})
    updatePin(el, status, false, { cents: 140, approximate: false }, true)
    expect(el.querySelector('.pin-price-text')?.textContent).toBe('1,40 €')
    expect(el.querySelector('.pin-name')?.textContent).toBe(
      'Cerveceria El Pilar',
    )
    expect(el.querySelector('.pin-name')?.getAttribute('aria-hidden')).toBe(
      'true',
    )
    expect(el.getAttribute('aria-label')).toBe(
      'Cerveceria El Pilar: Con sol ahora, caña 1,40 €',
    )
  })

  it('reports hovering with a mouse only, not touch', () => {
    const onHover = vi.fn()
    const el = createPin(() => {}, onHover)
    el.dispatchEvent(pointer('pointerenter', 'touch'))
    el.dispatchEvent(pointer('pointerenter', 'mouse'))
    el.dispatchEvent(pointer('pointerleave', 'mouse'))
    expect(onHover.mock.calls).toEqual([
      [el, true],
      [el, false],
    ])
    expect(el.classList.contains('pin-marker--hovered')).toBe(false)
  })

  describe('frontPin', () => {
    /** A badge at (x, y) on screen, 38 px wide, drawn at z-index `z`. */
    function badge(parent: HTMLElement, x: number, y: number, z: number) {
      const el = createPin(() => {})
      el.style.zIndex = String(z)
      const pin = el.querySelector('.pin')
      if (pin)
        pin.getBoundingClientRect = () =>
          DOMRect.fromRect({ x: x - 19, y: y - 19, width: 38, height: 38 })
      parent.append(el)
      return el
    }

    it('opens the badge in front when the mouse is on one peeking behind it', () => {
      const map = document.createElement('div')
      const behind = badge(map, 100, 100, 1)
      const front = badge(map, 120, 100, 3)
      const apart = badge(map, 200, 100, 1)
      expect(frontPin(behind)).toBe(front)
      expect(frontPin(front)).toBe(front)
      expect(frontPin(apart)).toBe(apart)
    })

    it('at the same z-index, the one later on the page is in front', () => {
      const map = document.createElement('div')
      const first = badge(map, 100, 100, 2)
      const later = badge(map, 110, 100, 2)
      expect(frontPin(first)).toBe(later)
    })

    it('marks the badge that opens while the mouse is on another', () => {
      const map = document.createElement('div')
      const behind = badge(map, 100, 100, 1)
      const front = badge(map, 120, 100, 3)
      behind.dispatchEvent(pointer('pointerenter', 'mouse'))
      expect(front.classList.contains('pin-marker--hovered')).toBe(true)
      expect(behind.classList.contains('pin-marker--hovered')).toBe(false)
      behind.dispatchEvent(pointer('pointerleave', 'mouse'))
      expect(front.classList.contains('pin-marker--hovered')).toBe(false)
    })
  })
})

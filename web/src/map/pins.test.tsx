import { describe, expect, it, vi } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import { createPin, updatePin } from './pins.ts'

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
    expect(onHover.mock.calls).toEqual([[true], [false]])
  })
})

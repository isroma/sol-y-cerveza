import { describe, expect, it, vi } from 'vitest'
import type { Terrace } from '../data/terraces.ts'
import { dayTrack } from '../sun/dayTrack.ts'
import { venueDay, venueStatus } from '../sun/venueStatus.ts'
import { calleMenacho, plazaAlta } from '../test/fixtures.ts'
import { cardScale, pitchForZoom } from './camera.ts'
import {
  FIT_GAP,
  FIT_MARGIN,
  fitCard,
  focusVenue,
  sizeCard,
} from './cardFit.ts'

// A .tsx test only to run in jsdom (see vite.config.ts), which has no
// layout: every rect and size below is stubbed.

type Box = { left: number; top: number; width: number; height: number }

function stubRect(el: Element, { left, top, width, height }: Box) {
  const rect = {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  }
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => rect })
}

/** The map area (`wrap`), its floating controls and the card marker. */
function layout({
  wrap,
  card,
  natural,
  controls = [],
}: {
  wrap: Box
  card: Box
  /** The card's full height when its body scrolls. */
  natural?: number
  controls?: { className: string; box: Box }[]
}) {
  const wrapEl = document.createElement('div')
  stubRect(wrapEl, wrap)
  for (const { className, box } of controls) {
    const el = document.createElement('div')
    el.className = className
    stubRect(el, box)
    wrapEl.append(el)
  }
  const marker = document.createElement('div')
  const cardEl = document.createElement('div')
  cardEl.className = 'pin-card'
  stubRect(cardEl, card)
  if (natural !== undefined) {
    const body = document.createElement('div')
    body.className = 'pin-card-body'
    Object.defineProperty(body, 'clientHeight', { value: 100 })
    Object.defineProperty(body, 'scrollHeight', {
      value: 100 + natural - card.height,
    })
    cardEl.append(body)
  }
  marker.append(cardEl)
  const map = { panBy: vi.fn() }
  return { map, marker, wrap: wrapEl }
}

const PHONE = { left: 0, top: 0, width: 400, height: 800 }

describe('fitCard', () => {
  it('leaves a card that fits alone, capped at the free height', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 60, top: 200, width: 280, height: 260 },
    })
    fitCard(map, marker, wrap)
    expect(map.panBy).not.toHaveBeenCalled()
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${800 - 2 * FIT_MARGIN}px`,
    )
  })

  it('does nothing while the card has no size yet', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 0, top: 0, width: 0, height: 0 },
    })
    fitCard(map, marker, wrap)
    expect(map.panBy).not.toHaveBeenCalled()
    expect(marker.style.getPropertyValue('--card-max')).toBe('')
  })

  it('pans a card past the right edge back inside the margin', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 200, top: 200, width: 280, height: 260 },
    })
    fitCard(map, marker, wrap)
    expect(map.panBy).toHaveBeenCalledWith([480 - (400 - FIT_MARGIN), 0], {
      duration: 300,
    })
  })

  it('pans a card down from under a control at the top', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 60, top: 40, width: 280, height: 260 },
      controls: [
        {
          className: 'map-city',
          box: { left: 16, top: 16, width: 200, height: 44 },
        },
      ],
    })
    fitCard(map, marker, wrap)
    expect(map.panBy).toHaveBeenCalledWith([0, 40 - (60 + FIT_GAP)], {
      duration: 300,
    })
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${800 - FIT_MARGIN - (60 + FIT_GAP)}px`,
    )
  })

  it('ignores controls outside the card column and hidden ones', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 60, top: 200, width: 200, height: 260 },
      controls: [
        {
          className: 'map-buttons',
          box: { left: 300, top: 16, width: 44, height: 200 },
        },
        {
          className: 'map-legend',
          box: { left: 60, top: 700, width: 0, height: 0 },
        },
      ],
    })
    fitCard(map, marker, wrap)
    expect(map.panBy).not.toHaveBeenCalled()
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${800 - 2 * FIT_MARGIN}px`,
    )
  })

  it('moves a tall card sideways past the buttons to use the full height', () => {
    // The buttons (top right) leave 476 px below them; the card needs 700.
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 200, top: 100, width: 160, height: 400 },
      natural: 700,
      controls: [
        {
          className: 'map-buttons',
          box: { left: 340, top: 16, width: 50, height: 284 },
        },
      ],
    })
    fitCard(map, marker, wrap)
    const past = 340 - FIT_GAP - 360
    expect(map.panBy).toHaveBeenCalledWith([-past, 0], { duration: 300 })
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${800 - 2 * FIT_MARGIN}px`,
    )
  })

  it('stays under the buttons when moving sideways would leave the map', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 30, top: 320, width: 340, height: 500 },
      natural: 700,
      controls: [
        {
          className: 'map-buttons',
          box: { left: 340, top: 16, width: 50, height: 284 },
        },
      ],
    })
    fitCard(map, marker, wrap)
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${800 - FIT_MARGIN - (300 + FIT_GAP)}px`,
    )
    // Taller than the free band: its top goes to the top of the band.
    expect(map.panBy).toHaveBeenCalledWith([0, 320 - (300 + FIT_GAP)], {
      duration: 300,
    })
  })

  it('caps the height in the card’s own (unscaled) pixels', () => {
    const { map, marker, wrap } = layout({
      wrap: PHONE,
      card: { left: 60, top: 200, width: 280, height: 260 },
    })
    marker.style.setProperty('--card-scale', '0.8')
    fitCard(map, marker, wrap)
    expect(marker.style.getPropertyValue('--card-max')).toBe(
      `${(800 - 2 * FIT_MARGIN) / 0.8}px`,
    )
  })
})

describe('sizeCard', () => {
  it('sets the card scale for the zoom', () => {
    const el = document.createElement('div')
    sizeCard(el, 15.2)
    expect(el.style.getPropertyValue('--card-scale')).toBe(
      String(cardScale(15.2)),
    )
  })
})

describe('focusVenue', () => {
  const track = dayTrack('2026-06-21')
  const status = (venue: Terrace) => venueStatus(venueDay(venue, track), 600)

  it('flies to the terrace, zoomed in for the full card', () => {
    const map = { getZoom: () => 14, easeTo: vi.fn() }
    focusVenue(map, status(plazaAlta))
    expect(map.easeTo).toHaveBeenCalledWith({
      center: [plazaAlta.terrace.lon, plazaAlta.terrace.lat],
      zoom: 16.5,
      pitch: pitchForZoom(16.5),
      offset: [0, -120],
      duration: 900,
    })
  })

  it('keeps a closer zoom and uses the venue without a terrace', () => {
    const map = { getZoom: () => 18, easeTo: vi.fn() }
    const noTerrace = { ...calleMenacho, terrace: null }
    focusVenue(map, status(noTerrace))
    expect(map.easeTo).toHaveBeenCalledWith(
      expect.objectContaining({
        center: [noTerrace.venue.lon, noTerrace.venue.lat],
        zoom: 18,
        pitch: pitchForZoom(18),
      }),
    )
  })
})

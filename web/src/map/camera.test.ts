import { describe, expect, it } from 'vitest'
import {
  CARD_FOLD_BELOW,
  CARD_FULL_FROM,
  CARD_GONE_BELOW,
  CARD_MIN_SCALE,
  cardLevel,
  cardOpacity,
  cardScale,
  FLAT_ZOOM,
  RELIEF_ZOOM,
  TILTED_PITCH,
  TILTED_ZOOM,
  pitchForZoom,
  SHADOW_OPACITY,
} from './camera.ts'

describe('SHADOW_OPACITY', () => {
  it('is faint in the top view and clear once tilted', () => {
    expect(SHADOW_OPACITY).toEqual([
      'interpolate',
      ['linear'],
      ['zoom'],
      RELIEF_ZOOM,
      0,
      TILTED_ZOOM,
      0.6,
    ])
  })
})

describe('pitchForZoom', () => {
  it('is a flat top view when zoomed out', () => {
    expect(pitchForZoom(12)).toBe(0)
    expect(pitchForZoom(FLAT_ZOOM)).toBe(0)
  })

  it('is the tilted view when zoomed in', () => {
    expect(pitchForZoom(TILTED_ZOOM)).toBe(TILTED_PITCH)
    expect(pitchForZoom(19)).toBe(TILTED_PITCH)
  })

  it('eases smoothly and monotonically in between', () => {
    const middle = pitchForZoom((FLAT_ZOOM + TILTED_ZOOM) / 2)
    expect(middle).toBeCloseTo(TILTED_PITCH / 2, 0)
    let previous = -1
    for (let zoom = FLAT_ZOOM; zoom <= TILTED_ZOOM; zoom += 0.1) {
      const pitch = pitchForZoom(zoom)
      expect(pitch).toBeGreaterThanOrEqual(previous)
      previous = pitch
    }
  })
})

describe('cardLevel', () => {
  it('folds the card away in the overview and opens it up close', () => {
    expect(cardLevel(13.8)).toBe('hidden')
    expect(cardLevel(CARD_GONE_BELOW)).toBe('compact')
    expect(cardLevel(15.5)).toBe('compact')
    expect(cardLevel(CARD_FULL_FROM)).toBe('full')
    expect(cardLevel(18)).toBe('full')
  })
})

describe('cardScale and cardOpacity', () => {
  it('shrink and fade the card smoothly as the map zooms out', () => {
    expect(cardScale(17)).toBe(1)
    expect(cardScale(16)).toBe(1)
    expect(cardScale(15.25)).toBe(0.8)
    expect(cardScale(CARD_GONE_BELOW)).toBe(CARD_MIN_SCALE)
    expect(cardScale(13)).toBe(CARD_MIN_SCALE)
    expect(cardOpacity(CARD_FOLD_BELOW)).toBe(1)
    expect(cardOpacity(14.75)).toBe(0.5)
    expect(cardOpacity(CARD_GONE_BELOW)).toBe(0)
  })
})

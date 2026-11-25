import { describe, expect, it } from 'vitest'
import {
  CARD_FOLD_BELOW,
  CARD_MIN_SCALE,
  cardFolded,
  cardScale,
  FLAT_ZOOM,
  TILTED_PITCH,
  TILTED_ZOOM,
  pitchForZoom,
} from './camera.ts'

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

describe('the venue card and the zoom', () => {
  it('folds the card into its badge in the overview', () => {
    expect(cardFolded(13.8)).toBe(true)
    expect(cardFolded(CARD_FOLD_BELOW)).toBe(false)
  })

  it('shrinks the card smoothly, never below its minimum size', () => {
    expect(cardScale(17)).toBe(1)
    expect(cardScale(16.5)).toBe(1)
    expect(cardScale(15.75)).toBe(0.8)
    expect(cardScale(CARD_FOLD_BELOW)).toBe(CARD_MIN_SCALE)
    expect(cardScale(13)).toBe(CARD_MIN_SCALE)
  })
})

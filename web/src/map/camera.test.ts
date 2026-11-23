import { describe, expect, it } from 'vitest'
import { FLAT_ZOOM, TILTED_PITCH, TILTED_ZOOM, pitchForZoom } from './camera.ts'

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

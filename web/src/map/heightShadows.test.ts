import { describe, expect, it } from 'vitest'
import { RELIEF_ZOOM, TILTED_ZOOM } from './camera.ts'
import { centreTile, shadowOpacity } from './heightShadows.ts'

describe('shadowOpacity', () => {
  it('fades in with the 3D buildings, as the polygon shadows do', () => {
    expect(shadowOpacity(RELIEF_ZOOM - 1)).toBe(0)
    expect(shadowOpacity(RELIEF_ZOOM)).toBe(0)
    expect(shadowOpacity((RELIEF_ZOOM + TILTED_ZOOM) / 2)).toBeCloseTo(0.3)
    expect(shadowOpacity(TILTED_ZOOM + 2)).toBe(0.6)
  })
})

describe('centreTile', () => {
  it('finds the zoom-15 tile under a point in Badajoz', () => {
    // The Irish Tavern's terrace; the pipeline wrote 15748/12538.png for it.
    expect(centreTile(-6.986606, 38.867629)).toEqual([15748, 12538])
  })
})

import { describe, expect, it } from 'vitest'
import { RELIEF_ZOOM, TILTED_ZOOM } from './camera.ts'
import {
  centreTile,
  shadeSize,
  shadowOpacity,
  tileSlot,
} from './heightShadows.ts'

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

describe('tileSlot', () => {
  it('gives each tile of any 5 × 5 window its own slot', () => {
    for (const [x0, y0] of [
      [15746, 12536],
      [15747, 12538],
      [0, 0],
    ] as const) {
      const slots = new Set<number>()
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 5; j++) slots.add(tileSlot(x0 + i, y0 + j))
      expect(slots.size).toBe(25)
      expect(Math.min(...slots)).toBe(0)
      expect(Math.max(...slots)).toBe(24)
    }
  })

  it('keeps a tile in the same slot when the window moves', () => {
    expect(tileSlot(15748, 12538)).toBe(tileSlot(15748 + 5, 12538 - 5))
  })
})

describe('shadeSize', () => {
  it('marches at half the CSS resolution', () => {
    // A phone at DPR 3: 390 × 844 CSS px.
    expect(shadeSize(1170, 2532, 3)).toEqual([195, 422])
    // A desktop at DPR 1.
    expect(shadeSize(1440, 900, 1)).toEqual([720, 450])
  })
})

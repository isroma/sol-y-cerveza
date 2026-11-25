import { describe, expect, it } from 'vitest'
import { partialSunEnabled } from './partialFlag.ts'

describe('partialSunEnabled', () => {
  it('is on only with partial=1', () => {
    expect(partialSunEnabled('?partial=1')).toBe(true)
    expect(partialSunEnabled('?t=17:00&partial=1&v=osm:node/1')).toBe(true)
    expect(partialSunEnabled('')).toBe(false)
    expect(partialSunEnabled('?partial=0')).toBe(false)
    expect(partialSunEnabled('?partial')).toBe(false)
  })
})

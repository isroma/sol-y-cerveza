import { describe, expect, it } from 'vitest'
import shippedFile from '../../public/data/terraces.json?raw'
import { sampleFile } from '../test/fixtures.ts'
import { terracesFileSchema } from './terraces.ts'

function withTerrace(overrides: Record<string, unknown>): unknown {
  return {
    ...sampleFile,
    terraces: [{ ...sampleFile.terraces[0], ...overrides }],
  }
}

describe('terracesFileSchema', () => {
  it('accepts the file shipped in public/data', () => {
    expect(terracesFileSchema.safeParse(JSON.parse(shippedFile)).success).toBe(
      true,
    )
  })

  it('accepts a venue without a known terrace', () => {
    const file = withTerrace({ terrace: null, horizon: null, verified: null })
    expect(terracesFileSchema.safeParse(file).success).toBe(true)
  })

  it('accepts a null horizon and a verified date', () => {
    const file = withTerrace({ horizon: null, verified: '2026-11-20' })
    expect(terracesFileSchema.safeParse(file).success).toBe(true)
  })

  it('accepts a leaf-off horizon, null or absent', () => {
    for (const horizon_winter of [Array(360).fill(0), null, undefined])
      expect(
        terracesFileSchema.safeParse(withTerrace({ horizon_winter })).success,
      ).toBe(true)
  })

  it.each([
    [
      'a leaf-off horizon with 359 bins',
      withTerrace({ horizon_winter: Array(359).fill(0) }),
    ],
    [
      'a leaf-off horizon without a horizon',
      withTerrace({ horizon: null, horizon_winter: Array(360).fill(0) }),
    ],
    ['an old version', { ...sampleFile, version: 1 }],
    ['a missing attribution', { ...sampleFile, attribution: undefined }],
    ['a non-UTC timestamp', { ...sampleFile, generated: '22/11/2026' }],
    ['a horizon with 359 bins', withTerrace({ horizon: Array(359).fill(0) })],
    ['a horizon above 900', withTerrace({ horizon: Array(360).fill(901) })],
    ['a fractional horizon', withTerrace({ horizon: Array(360).fill(1.5) })],
    ['an unknown kind', withTerrace({ kind: 'disco' })],
    ['an out-of-range latitude', withTerrace({ terrace: { lat: 91, lon: 0 } })],
    ['a malformed verified date', withTerrace({ verified: '20/11/2026' })],
  ])('rejects %s', (_label, file) => {
    expect(terracesFileSchema.safeParse(file).success).toBe(false)
  })
})

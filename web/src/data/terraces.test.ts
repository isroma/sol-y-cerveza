import { describe, expect, it } from 'vitest'
import shippedFile from '../../public/data/terraces.json?raw'
import { sampleFile } from '../test/fixtures.ts'
import { parseTerracesFile, terracesFileSchema } from './terraces.ts'

function withTerrace(overrides: Record<string, unknown>): unknown {
  return {
    ...sampleFile,
    terraces: [{ ...sampleFile.terraces[0], ...overrides }],
  }
}

/** A valid 360-bin horizon (0 to 900) with `bin` in the middle. */
function oneBin(bin: unknown): unknown[] {
  const horizon: unknown[] = Array.from({ length: 360 }, (_, i) => i % 901)
  horizon[180] = bin
  return horizon
}

describe('terracesFileSchema', () => {
  it('accepts horizon bins at both bounds', () => {
    const horizon = Array.from({ length: 360 }, (_, i) => (i % 2 ? 900 : 0))
    const file = withTerrace({ horizon, horizon_winter: horizon })
    expect(terracesFileSchema.safeParse(file).success).toBe(true)
    const control = withTerrace({ horizon: oneBin(450) })
    expect(terracesFileSchema.safeParse(control).success).toBe(true)
  })

  it('accepts the file shipped in public/data, every record of it', () => {
    const json: unknown = JSON.parse(shippedFile)
    expect(terracesFileSchema.safeParse(json).error).toBeUndefined()
    const { file, dropped } = parseTerracesFile(json)
    expect(dropped).toBe(0)
    expect(file.terraces.length).toBeGreaterThan(0)
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
    ['a horizon with 361 bins', withTerrace({ horizon: Array(361).fill(0) })],
    ['a horizon with one bin above 900', withTerrace({ horizon: oneBin(901) })],
    ['a horizon with one negative bin', withTerrace({ horizon: oneBin(-1) })],
    [
      'a horizon with one fractional bin',
      withTerrace({ horizon: oneBin(0.5) }),
    ],
    ['a horizon with one NaN bin', withTerrace({ horizon: oneBin(NaN) })],
    ['a horizon with one string bin', withTerrace({ horizon: oneBin('10') })],
    ['a horizon with one null bin', withTerrace({ horizon: oneBin(null) })],
    [
      'a horizon with an undefined bin',
      withTerrace({ horizon: oneBin(undefined) }),
    ],
    [
      'a leaf-off horizon with one fractional bin',
      withTerrace({ horizon_winter: oneBin(0.5) }),
    ],
    [
      'a leaf-off horizon with one bin above 900',
      withTerrace({ horizon_winter: oneBin(901) }),
    ],
    ['an unknown kind', withTerrace({ kind: 'disco' })],
    ['an out-of-range latitude', withTerrace({ terrace: { lat: 91, lon: 0 } })],
    ['a malformed verified date', withTerrace({ verified: '20/11/2026' })],
  ])('rejects %s', (_label, file) => {
    expect(terracesFileSchema.safeParse(file).success).toBe(false)
  })
})

describe('parseTerracesFile', () => {
  it('keeps a valid file as it is', () => {
    expect(parseTerracesFile(sampleFile)).toEqual({
      file: sampleFile,
      dropped: 0,
    })
  })

  it.each([
    ['an unknown kind', { kind: 'disco' }],
    [
      'an unknown price brand',
      {
        prices: [
          { item: 'tercio', brand: 'nueva', cents: 250, seen: '2026-11-20' },
        ],
      },
    ],
    ['a horizon with 359 bins', { horizon: Array(359).fill(0) }],
  ])('drops a record with %s and keeps the rest', (_label, overrides) => {
    const [first, ...rest] = sampleFile.terraces
    const { file, dropped } = parseTerracesFile({
      ...sampleFile,
      terraces: [{ ...first, ...overrides }, ...rest],
    })
    expect(dropped).toBe(1)
    expect(file.terraces).toEqual(rest)
    expect(file.attribution).toEqual(sampleFile.attribution)
  })

  it('keeps accepted sun corrections, and records without any', () => {
    const sun_corrections = [
      { leaf_off: false, from: 171, to: 181, altitude: 251 },
      { leaf_off: true, from: 355, to: 3, altitude: 0 },
    ]
    const { file, dropped } = parseTerracesFile(
      withTerrace({ sun_corrections }),
    )
    expect(dropped).toBe(0)
    expect(file.terraces[0]?.sun_corrections).toEqual(sun_corrections)
    expect(
      parseTerracesFile(sampleFile).file.terraces[0]?.sun_corrections,
    ).toBe(undefined)
  })

  it.each([
    ['not a list', { leaf_off: false, from: 1, to: 2, altitude: 3 }],
    [
      'a bin out of range',
      [{ leaf_off: false, from: 360, to: 2, altitude: 3 }],
    ],
    ['a cap above 900', [{ leaf_off: false, from: 1, to: 2, altitude: 901 }]],
    ['a fractional cap', [{ leaf_off: false, from: 1, to: 2, altitude: 2.5 }]],
    ['no season', [{ from: 1, to: 2, altitude: 3 }]],
    ['null', null],
  ])('treats sun corrections with %s as absent', (_label, sun_corrections) => {
    const { file, dropped } = parseTerracesFile(
      withTerrace({ sun_corrections }),
    )
    expect(dropped).toBe(0)
    expect(file.terraces).toHaveLength(1)
    expect(file.terraces[0]?.sun_corrections).toBeUndefined()
  })

  it('drops records that are not objects', () => {
    const { file, dropped } = parseTerracesFile({
      ...sampleFile,
      terraces: [null, 'x', ...sampleFile.terraces],
    })
    expect(dropped).toBe(2)
    expect(file.terraces).toEqual(sampleFile.terraces)
  })

  it.each([
    ['an old version', { ...sampleFile, version: 1 }],
    ['a missing attribution', { ...sampleFile, attribution: undefined }],
    ['a non-UTC timestamp', { ...sampleFile, generated: '22/11/2026' }],
    ['terraces that are not a list', { ...sampleFile, terraces: {} }],
    ['not an object', []],
  ])('still rejects the whole file with %s', (_label, json) => {
    expect(() => parseTerracesFile(json)).toThrow()
  })
})

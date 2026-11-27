import { describe, expect, it } from 'vitest'
import {
  isTooHigh,
  parseProbeOutput,
  parseProbeQuery,
  probeKey,
  probeOutputSchema,
  probeUrl,
  terraceHorizon,
  type ProbeResult,
} from './probe.ts'

const result: ProbeResult = {
  horizon: new Array<number>(360).fill(120),
  horizon_low: null,
  height_above_ground: 0.4,
  max_height_above_ground: 2,
}

const query = (text: string) => parseProbeQuery(new URLSearchParams(text))

describe('parseProbeQuery', () => {
  it('accepts a position in Badajoz and rounds it to 5 decimals', () => {
    expect(query('lat=38.8825612&lon=-6.9697649')).toEqual({
      ok: true,
      at: { lat: 38.88256, lon: -6.96976 },
    })
  })

  it.each([
    ['lat=&lon=-6.97', 'decimal numbers'],
    ['lon=-6.97', 'decimal numbers'],
    ['lat=38.88;rm -rf&lon=-6.97', 'decimal numbers'],
    ['lat=1e1&lon=-6.97', 'decimal numbers'],
    ['lat=Infinity&lon=-6.97', 'decimal numbers'],
    ['lat=40.4168&lon=-3.7038', 'outside the Badajoz area'],
    ['lat=38.88&lon=-7.1', 'outside the Badajoz area'],
  ])('refuses %s', (text, error) => {
    const parsed = query(text)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error).toContain(error)
  })
})

describe('probe cache keys and URLs', () => {
  it('share a key for points within the rounding', () => {
    expect(probeKey({ lat: 38.882561, lon: -6.969761 })).toBe(
      probeKey({ lat: 38.882559, lon: -6.969759 }),
    )
    expect(probeKey({ lat: 38.88256, lon: -6.96976 })).not.toBe(
      probeKey({ lat: 38.88258, lon: -6.96976 }),
    )
  })

  it('request the rounded position', () => {
    expect(probeUrl({ lat: 38.8825612, lon: -6.9697649 })).toBe(
      '/__admin/probe?lat=38.88256&lon=-6.96976',
    )
  })
})

describe('probe output', () => {
  it('parses a result from the last line of stdout', () => {
    const stdout = `noise\n${JSON.stringify(result)}\n`
    expect(parseProbeOutput(stdout)).toEqual(result)
  })

  it('parses an error, keeping the missing-rasters flag', () => {
    const error = { error: 'LiDAR rasters not found', missing_rasters: true }
    expect(parseProbeOutput(JSON.stringify(error))).toEqual(error)
  })

  it('rejects malformed output', () => {
    expect(parseProbeOutput('Traceback (most recent call last):')).toBeNull()
    expect(parseProbeOutput('')).toBeNull()
    const short = { ...result, horizon: [1, 2, 3] }
    expect(parseProbeOutput(JSON.stringify(short))).toBeNull()
    const tooHigh = { ...result, horizon: new Array<number>(360).fill(901) }
    expect(probeOutputSchema.safeParse(tooHigh).success).toBe(false)
  })
})

describe('isTooHigh', () => {
  it('flags a pin above the build threshold, not at or below it', () => {
    expect(isTooHigh({ ...result, height_above_ground: 6.3 })).toBe(true)
    expect(isTooHigh({ ...result, height_above_ground: 2 })).toBe(false)
    expect(isTooHigh({ ...result, height_above_ground: null })).toBe(false)
  })
})

describe('terraceHorizon', () => {
  it('is the pin horizon without an envelope', () => {
    expect(terraceHorizon(result)).toBe(result.horizon)
  })

  it('is the envelope, in tenths, when there is one', () => {
    const low = terraceHorizon({ ...result, horizon_low: '%'.repeat(360) })
    expect(low).toHaveLength(360)
    expect(low[0]).toBe(20)
  })

  it('falls back to the pin horizon on a malformed envelope', () => {
    expect(terraceHorizon({ ...result, horizon_low: 'short' })).toBe(
      result.horizon,
    )
  })
})

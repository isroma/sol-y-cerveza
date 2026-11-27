import { describe, expect, it } from 'vitest'
import {
  correctHorizon,
  correctionsByVenue,
  parseSunCorrections,
  runBins,
} from './corrections.ts'
import { sunCorrection as correction } from '../test/fixtures.ts'

const flat = (tenths: number) => new Array<number>(360).fill(tenths)

describe('parseSunCorrections', () => {
  it('keeps the corrections it can read and drops the rest', () => {
    const good = correction({})
    expect(
      parseSunCorrections({
        corrections: [
          good,
          { ...good, from: 360 },
          { ...good, altitude: 24.3 },
          { venueId: 'x' },
        ],
      }),
    ).toEqual([good])
  })

  it('throws on an answer of the wrong shape', () => {
    expect(() => parseSunCorrections({ prices: [] })).toThrow()
  })
})

describe('runBins', () => {
  it('runs from one bin to another, both included', () => {
    expect(runBins(170, 173)).toEqual([170, 171, 172, 173])
    expect(runBins(5, 5)).toEqual([5])
  })

  it('wraps across north when from > to', () => {
    expect(runBins(358, 1)).toEqual([358, 359, 0, 1])
  })
})

describe('correctHorizon', () => {
  it('caps the run at the lower of the model and the correction', () => {
    const horizon = flat(300)
    horizon[171] = 150
    const corrected = correctHorizon(
      horizon,
      [correction({ from: 170, to: 172, altitude: 200 })],
      false,
    )
    expect(corrected?.all.slice(169, 174)).toEqual([300, 200, 150, 200, 300])
    // Unconfirmed: the confirmed horizon is the model's.
    expect(corrected?.confirmed?.slice(169, 174)).toEqual([
      300, 300, 150, 300, 300,
    ])
  })

  it('wraps a run across north', () => {
    const corrected = correctHorizon(
      flat(300),
      [correction({ from: 359, to: 0, altitude: 100 })],
      false,
    )
    expect(corrected?.all[358]).toBe(300)
    expect(corrected?.all[359]).toBe(100)
    expect(corrected?.all[0]).toBe(100)
    expect(corrected?.all[1]).toBe(300)
  })

  it('counts a correction only in its own season', () => {
    const winter = [correction({ leafOff: true })]
    expect(correctHorizon(flat(300), winter, false)).toBeNull()
    expect(correctHorizon(flat(300), winter, true)).not.toBeNull()
  })

  it('has nothing approximate when every cap is confirmed', () => {
    const corrected = correctHorizon(
      flat(300),
      [correction({ confirmed: true })],
      false,
    )
    expect(corrected?.all[180]).toBe(200)
    expect(corrected?.confirmed).toBeNull()
  })

  it('takes the lower cap where a confirmed and a visitors run overlap', () => {
    const corrected = correctHorizon(
      flat(300),
      [
        correction({ confirmed: true, altitude: 250 }),
        correction({ confirmed: false, altitude: 200 }),
      ],
      false,
    )
    expect(corrected?.all[180]).toBe(200)
    expect(corrected?.confirmed?.[180]).toBe(250)
  })
})

describe('correctionsByVenue', () => {
  it('groups the corrections by venue', () => {
    const a = correction({ venueId: 'a' })
    const b = correction({ venueId: 'b' })
    const a2 = correction({ venueId: 'a', from: 10, to: 12 })
    const byVenue = correctionsByVenue([a, b, a2])
    expect(byVenue.get('a')).toEqual([a, a2])
    expect(byVenue.get('b')).toEqual([b])
  })
})

// Shade floors (#527, ADR-0014).
describe('shade floors', () => {
  it('reads the answer’s shade list as floors, and an answer without one', () => {
    const run = correction({})
    expect(parseSunCorrections({ corrections: [], shade: [run] })).toEqual([
      { ...run, floor: true },
    ])
    expect(parseSunCorrections({ corrections: [run] })).toEqual([run])
  })

  it('raises the horizon to the floor, never lowers it', () => {
    const floor = {
      leafOff: false,
      from: 10,
      to: 11,
      altitude: 300,
      confirmed: true,
      floor: true,
    }
    const result = correctHorizon(flat(200), [floor], false)
    expect(result?.all[10]).toBe(300)
    expect(result?.all[12]).toBe(200)
    expect(correctHorizon(flat(400), [floor], false)?.all[10]).toBe(400)
    expect(result?.confirmed).toBeNull()
  })

  it('lets a cap win where both apply', () => {
    const floor = {
      leafOff: false,
      from: 10,
      to: 10,
      altitude: 300,
      confirmed: true,
      floor: true,
    }
    const cap = {
      leafOff: false,
      from: 10,
      to: 10,
      altitude: 150,
      confirmed: true,
    }
    expect(correctHorizon(flat(200), [cap, floor], false)?.all[10]).toBe(150)
  })

  it('keeps an unconfirmed floor out of the confirmed horizon', () => {
    const floor = {
      leafOff: false,
      from: 10,
      to: 10,
      altitude: 300,
      confirmed: false,
      floor: true,
    }
    const result = correctHorizon(flat(200), [floor], false)
    expect(result?.all[10]).toBe(300)
    expect(result?.confirmed?.[10]).toBe(200)
  })
})

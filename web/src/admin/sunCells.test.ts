import { describe, expect, it } from 'vitest'
import { dayTrack } from '../sun/dayTrack.ts'
import type { ProbeCell, ProbeResult } from './probe.ts'
import { sunCells } from './sunCells.ts'

const OPEN = '#'.repeat(360) // 0° all round: sun all day
const WALLED = '~'.repeat(360) // 90° all round: no sun

const cell = (over: Partial<ProbeCell>): ProbeCell => ({
  lat: 38.8705,
  lon: -6.985,
  skip: null,
  horizon: OPEN,
  horizon_winter: null,
  ...over,
})

const result = (cells: ProbeCell[]): ProbeResult => ({
  horizon: new Array<number>(360).fill(0),
  horizon_winter: null,
  horizon_low: null,
  horizon_low_winter: null,
  height_above_ground: 0,
  max_height_above_ground: 2,
  cells,
})

const december = dayTrack('2026-12-21')

describe('sunCells', () => {
  it('gives each cell its minutes of sun today', () => {
    const { features } = sunCells(
      result([cell({}), cell({ horizon: WALLED })]),
      december,
      false,
    )
    const [open, walled] = features.map((f) => f.properties.minutes)
    expect(open).toBeGreaterThan(500)
    expect(walled).toBe(0)
  })

  it('keeps left-out cells, without minutes', () => {
    const { features } = sunCells(
      result([cell({ skip: 'road', horizon: null })]),
      december,
      false,
    )
    expect(features[0]?.properties).toEqual({ minutes: null, skip: 'road' })
  })

  it('uses the leaf-off horizon in the leaf-off period', () => {
    const trees = result([cell({ horizon: WALLED, horizon_winter: OPEN })])
    expect(
      sunCells(trees, december, false).features[0]?.properties.minutes,
    ).toBe(0)
    expect(
      sunCells(trees, december, true).features[0]?.properties.minutes,
    ).toBeGreaterThan(500)
  })

  it('draws a 2 m square round each cell centre', () => {
    const ring = sunCells(result([cell({})]), december, false).features[0]
      ?.geometry.coordinates[0]
    expect(ring).toHaveLength(5)
    const [west, south] = ring?.[0] ?? [0, 0]
    const [east, north] = ring?.[2] ?? [0, 0]
    expect((north - south) * 111_320).toBeCloseTo(2, 5)
    expect(
      (east - west) * 111_320 * Math.cos((38.8705 * Math.PI) / 180),
    ).toBeCloseTo(2, 5)
  })
})

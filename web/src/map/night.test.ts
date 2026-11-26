import type { LayerSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { mixHex, nightDepth, nightPaint } from './night.ts'

const layers = [
  { id: 'background', type: 'background' },
  { id: 'water', type: 'fill', source: 's' },
  {
    id: 'road_area_pattern',
    type: 'fill',
    source: 's',
    paint: { 'fill-pattern': 'pedestrian_polygon' },
  },
  { id: 'park', type: 'fill', source: 's' },
  { id: 'building', type: 'fill', source: 's' },
  { id: 'landuse_residential', type: 'fill', source: 's' },
  { id: 'building-3d', type: 'fill-extrusion', source: 's' },
  { id: 'tree-crowns', type: 'fill-extrusion', source: 's' },
  { id: 'waterway_river', type: 'line', source: 's' },
  { id: 'road_primary', type: 'line', source: 's' },
  { id: 'label_city', type: 'symbol', source: 's' },
  { id: 'shade', type: 'raster', source: 's' },
] as LayerSpecification[]

describe('nightPaint', () => {
  const byLayer = (id: string) =>
    Object.fromEntries(
      nightPaint(layers)
        .filter((patch) => patch.layer === id)
        .map((patch) => [patch.property, patch.value]),
    )

  it('darkens the ground, water, greenery, buildings and tree crowns', () => {
    expect(byLayer('background')['background-color']).toBe('#10131D')
    expect(byLayer('water')['fill-color']).toBe('#16263D')
    expect(byLayer('park')['fill-color']).toBe('#152019')
    expect(byLayer('building')).toEqual({
      'fill-color': '#222838',
      'fill-outline-color': '#222838',
    })
    expect(byLayer('landuse_residential')['fill-color']).toBe('#161A26')
    expect(byLayer('building-3d')['fill-extrusion-color']).toBe('#2B3144')
    expect(byLayer('tree-crowns')['fill-extrusion-color']).toBe('#22302A')
  })

  it('fades patterned areas, which ignore the fill colour', () => {
    expect(byLayer('road_area_pattern')['fill-opacity']).toBe(0.12)
    expect(byLayer('water')['fill-opacity']).toBeUndefined()
  })

  it('dims roads and keeps rivers blue', () => {
    expect(byLayer('road_primary')['line-color']).toBe('#2A3043')
    expect(byLayer('waterway_river')['line-color']).toBe('#16263D')
  })

  it('lightens labels and leaves other layer types alone', () => {
    expect(byLayer('label_city')).toEqual({
      'text-color': '#AAB2C8',
      'text-halo-color': '#10131D',
    })
    expect(byLayer('shade')).toEqual({})
  })
})

describe('nightPaint: grey dots', () => {
  const dots = [
    { id: 'venues-unconfirmed', type: 'circle', source: 's' },
  ] as LayerSpecification[]
  const paint = (depth: number) =>
    Object.fromEntries(
      nightPaint(dots, depth).map((patch) => [patch.property, patch.value]),
    )

  it('empties the dots into a tan ring by night, the selected one stays filled', () => {
    const night = paint(1)
    expect(night['circle-opacity']).toEqual(['case', ['get', 'selected'], 1, 0])
    expect(night['circle-stroke-color']).toEqual([
      'case',
      ['get', 'selected'],
      '#FFFFFF',
      '#9C8670',
    ])
  })

  it('looks like the day at sunset', () => {
    const dusk = paint(0)
    expect(dusk['circle-opacity']).toEqual(['case', ['get', 'selected'], 1, 1])
    expect(dusk['circle-stroke-color']).toEqual([
      'case',
      ['get', 'selected'],
      '#FFFFFF',
      '#FFFFFF',
    ])
  })
})

describe('nightDepth', () => {
  it('is null by day and 0 right at sunset', () => {
    expect(nightDepth(12)).toBeNull()
    expect(nightDepth(0)).toBe(0)
  })

  it('deepens with the sun below the horizon, full night at 18°', () => {
    expect(nightDepth(-9)).toBe(0.5)
    expect(nightDepth(-18)).toBe(1)
    expect(nightDepth(-50)).toBe(1)
    expect(nightDepth(-3)).toBeLessThan(nightDepth(-12) ?? 0)
  })
})

describe('graded night', () => {
  const background = (depth: number) =>
    nightPaint(layers, depth).find((patch) => patch.layer === 'background')
      ?.value

  it('is softer at dusk than overnight', () => {
    expect(background(0)).toBe('#343A52')
    expect(background(1)).toBe('#10131D')
    expect(background(0.5)).toBe(mixHex('#343A52', '#10131D', 0.5))
  })
})

describe('mixHex', () => {
  it('blends two colours', () => {
    expect(mixHex('#000000', '#FFFFFF', 0)).toBe('#000000')
    expect(mixHex('#000000', '#FFFFFF', 1)).toBe('#FFFFFF')
    expect(mixHex('#000000', '#FFFFFF', 0.5)).toBe('#808080')
  })
})

import type { LayerSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { nightPaint } from './night.ts'

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

  it('darkens the ground, water, greenery and buildings', () => {
    expect(byLayer('background')['background-color']).toBe('#10131D')
    expect(byLayer('water')['fill-color']).toBe('#16263D')
    expect(byLayer('park')['fill-color']).toBe('#152019')
    expect(byLayer('building')).toEqual({
      'fill-color': '#222838',
      'fill-outline-color': '#222838',
    })
    expect(byLayer('landuse_residential')['fill-color']).toBe('#161A26')
    expect(byLayer('building-3d')['fill-extrusion-color']).toBe('#2B3144')
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

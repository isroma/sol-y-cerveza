import type { StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import { ROOF_COLOR, sunLight, sunlitStyle } from './mapStyle.ts'

const base: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#000' },
    },
    { id: 'poi_r20', type: 'symbol', source: 'x', 'source-layer': 'poi' },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'x',
      'source-layer': 'building',
      paint: { 'fill-extrusion-height': ['get', 'render_height'] },
    },
    { id: 'road_minor', type: 'line', source: 'x', 'source-layer': 'road' },
    {
      id: 'poi_r1',
      type: 'symbol',
      source: 'x',
      'source-layer': 'poi',
      layout: {
        'icon-image': 'x',
        'text-field': '{name}',
        'text-offset': [0, 0.6],
      },
    },
  ],
}

describe('sunlitStyle', () => {
  const style = sunlitStyle(base)

  it('drops POI icons and keeps the rest in order', () => {
    expect(style.layers.map((l) => l.id)).toEqual([
      'background',
      'building-3d',
      'building-roof',
      'road_minor',
      'poi_r1',
    ])
  })

  it('recolours known layers and keeps their other paint', () => {
    const building = style.layers.find((l) => l.id === 'building-3d')
    expect(building && 'paint' in building && building.paint).toMatchObject({
      'fill-extrusion-color': '#F2E6D6',
      'fill-extrusion-height': ['*', 1.4, ['get', 'render_height']],
    })
  })

  it('caps every 3D building with a lighter roof', () => {
    const roof = style.layers.find((l) => l.id === 'building-roof')
    expect(roof && 'paint' in roof && roof.paint).toMatchObject({
      'fill-extrusion-color': ROOF_COLOR,
      'fill-extrusion-base': ['*', 1.4, ['get', 'render_height']],
      'fill-extrusion-height': [
        '+',
        ['*', 1.4, ['get', 'render_height']],
        0.84,
      ],
    })
  })

  it('keeps the top view flat: buildings rise only as the view tilts', () => {
    const building = style.layers.find((l) => l.id === 'building-3d')
    expect(building && 'paint' in building && building.paint).toMatchObject({
      'fill-extrusion-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        15.3,
        0,
        15.6,
        1,
      ],
    })
  })

  it('draws streets white with a sand casing, Apple Maps style', () => {
    const roads = sunlitStyle({
      version: 8,
      sources: {},
      layers: [
        { id: 'road_minor', type: 'line', source: 's', paint: {} },
        { id: 'road_minor_casing', type: 'line', source: 's', paint: {} },
        {
          id: 'road_trunk_primary_casing',
          type: 'line',
          source: 's',
          paint: {},
        },
        { id: 'road_major_rail', type: 'line', source: 's', paint: {} },
      ],
    }).layers.map((l) => ('paint' in l ? l.paint : undefined))
    expect(roads).toEqual([
      { 'line-color': '#FFFFFF' },
      { 'line-color': '#E4D6C3' },
      { 'line-color': '#E6CFA8' },
      { 'line-color': '#D9CDBC' },
    ])
  })

  it('keeps landmark labels as text only', () => {
    const poi = style.layers.find((l) => l.id === 'poi_r1')
    expect(poi && 'layout' in poi && poi.layout).toEqual({
      'text-field': '{name}',
      'text-offset': [0, 0],
    })
  })

  it('does not mutate the input', () => {
    expect(base.layers).toHaveLength(5)
  })
})

describe('sunLight', () => {
  it('comes from the sun azimuth at a fixed elevation', () => {
    expect(sunLight({ altitude: 60, azimuth: 200 }).position).toEqual([
      1.15, 200, 35,
    ])
    expect(sunLight({ altitude: 20, azimuth: 120 }).position).toEqual([
      1.15, 120, 35,
    ])
  })

  it('warms up when the sun is low', () => {
    expect(sunLight({ altitude: 5, azimuth: 250 }).color).toBe('#FFE7C4')
    expect(sunLight({ altitude: 40, azimuth: 250 }).color).toBe('#FFF6EA')
  })

  it('is dim and cool at night', () => {
    const night = sunLight({ altitude: -10, azimuth: 0 })
    expect(night.intensity).toBeLessThan(0.4)
    expect(night.color).toBe('#D5DAEC')
  })
})

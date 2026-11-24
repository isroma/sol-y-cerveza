import type { MapGeoJSONFeature } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'
import type { SunPosition } from '../sun/sunState.ts'
import {
  ShadowCache,
  type ShadowChange,
  type ShadowMap,
} from './shadowLayer.ts'

const noon: SunPosition = { altitude: 30, azimuth: 180 }
const later: SunPosition = { altitude: 25, azimuth: 200 }
const night: SunPosition = { altitude: -10, azimuth: 0 }

function building(id: number, height = 10, lon = -6.97): MapGeoJSONFeature {
  const ring = [
    [lon, 38.88],
    [lon + 0.0001, 38.88],
    [lon + 0.0001, 38.8801],
    [lon, 38.8801],
    [lon, 38.88],
  ]
  // Only the fields ShadowCache reads.
  return {
    id,
    properties: { render_height: height },
    geometry: { type: 'Polygon', coordinates: [ring] },
  } as unknown as MapGeoJSONFeature
}

function fakeMap(zoom: number, buildings: MapGeoJSONFeature[]) {
  return {
    getZoom: vi.fn(() => zoom),
    querySourceFeatures: vi.fn(() => buildings),
  } satisfies ShadowMap
}

/** The shadows sent: all of them, or only the new ones. */
const sent = (change: ShadowChange | null) =>
  change === null ? null : 'data' in change ? change.data.features : change.add

const other = building(2, 10, -6.96)

describe('ShadowCache', () => {
  it('casts a shadow per building', () => {
    const cache = new ShadowCache()
    expect(sent(cache.update(fakeMap(16.5, [building(1)]), noon))).toHaveLength(
      1,
    )
  })

  it('redoes nothing for buildings it already has', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1), other]), noon)
    // Zoomed in: fewer buildings in view, none new.
    expect(cache.update(fakeMap(18, [building(1)]), noon)).toBeNull()
  })

  it('sends only the shadows of new buildings, keeping the rest', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1)]), noon)
    expect(cache.update(fakeMap(16.5, [other]), noon)).toEqual({
      add: [expect.anything()],
      remove: [],
    })
  })

  it('gives every shadow its own id', () => {
    const cache = new ShadowCache()
    const first = sent(cache.update(fakeMap(16.5, [building(1)]), noon))
    const second = sent(cache.update(fakeMap(16.5, [other]), noon))
    expect(first?.[0]?.id).not.toBe(second?.[0]?.id)
  })

  it('adds a newly loaded piece of a known building', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1)]), noon)
    const pieces = [building(1), building(1, 10, -6.9699)]
    expect(sent(cache.update(fakeMap(16.5, pieces), noon))).toHaveLength(1)
  })

  it('recasts every building for a new sun', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1), other]), noon)
    const change = cache.update(fakeMap(16.5, []), later)
    expect(change && 'data' in change).toBe(true)
    expect(sent(change)).toHaveLength(2)
  })

  it('reads no tiles when zoomed out, and keeps the shadows', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1)]), noon)
    const map = fakeMap(14, [other])
    expect(cache.update(map, noon)).toBeNull()
    expect(map.querySourceFeatures).not.toHaveBeenCalled()
  })

  it('clears them once at night', () => {
    const cache = new ShadowCache()
    cache.update(fakeMap(16.5, [building(1)]), noon)
    expect(sent(cache.update(fakeMap(16.5, [building(1)]), night))).toEqual([])
    expect(cache.update(fakeMap(16.5, [building(1)]), night)).toBeNull()
  })
})

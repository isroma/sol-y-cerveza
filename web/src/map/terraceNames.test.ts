import type { Map as MapLibreMap } from 'maplibre-gl'
import { describe, expect, it, vi } from 'vitest'
import type { VenueStatus } from '../sun/venueStatus.ts'
import {
  addTerraceNameLayers,
  farShare,
  terraceNamesData,
  updateTerraceNames,
} from './terraceNames.ts'

const status = (
  id: string,
  category: VenueStatus['category'],
  hasTerrace = true,
): VenueStatus =>
  ({
    venue: {
      id,
      name: `Bar ${id}`,
      kind: 'bar',
      venue: { lat: 38.88, lon: -6.97 },
      terrace: { lat: 38.8801, lon: -6.9701 },
      sources: ['osm'],
      verified: null,
      horizon: null,
    },
    hasTerrace,
    category,
  }) as unknown as VenueStatus

describe('terraceNamesData', () => {
  it('names terrace badges, sunny ones marked, at the terrace', () => {
    const data = terraceNamesData(
      [status('a', 'sun'), status('b', 'nosun'), status('c', 'sun', false)],
      null,
      new Set(),
    )
    expect(
      data.features.map((f) => [f.properties.id, f.properties.sunny]),
    ).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(data.features[0]?.geometry.coordinates).toEqual([-6.9701, 38.8801])
  })

  it('leaves out the selected badge and names none showing a price', () => {
    const data = terraceNamesData(
      [status('a', 'sun'), status('b', 'sun')],
      'a',
      new Set(['b']),
    )
    expect(data.features.map((f) => f.properties)).toEqual([
      expect.objectContaining({ id: 'b', priced: true, named: false }),
    ])
  })
})

/** A tilted map 800 px tall; `y` gives each point's screen height. */
function fakeMap(y: (lon: number, lat: number) => number) {
  let height = 800
  const reads = { height: 0 }
  const handlers = new Map<string, () => void>()
  const setFilter = vi.fn()
  const canvas = {
    style: {},
    get clientHeight() {
      reads.height++
      return height
    },
  }
  const map = {
    hasImage: () => false,
    addImage: () => {},
    addSource: () => {},
    addLayer: () => {},
    on: (event: string, ...rest: unknown[]) => {
      const handler = rest.at(-1)
      if (rest.length === 1 && typeof handler === 'function')
        handlers.set(event, () => {
          handler()
        })
    },
    getSource: () => ({ setData: () => Promise.resolve() }),
    getLayer: () => ({}),
    setFilter,
    getCanvas: () => canvas,
    getPitch: () => 60,
    project: ([lon, lat]: [number, number]) => ({ x: 0, y: y(lon, lat) }),
  }
  const resize = (to: number) => {
    height = to
    handlers.get('resize')?.()
  }
  return {
    map: map as unknown as MapLibreMap,
    reads,
    setFilter,
    resize,
  }
}

describe('updateTerraceNames', () => {
  const data = terraceNamesData([], null, new Set())

  it('hides the far dots without reading the canvas size each time', () => {
    // A dot 200 px from the top: far while the far share (35 %) of the
    // canvas is more than 200 px.
    const { map, reads, setFilter, resize } = fakeMap(() => 200)
    addTerraceNameLayers(map, () => {})
    const dots = [{ id: 'd', lon: -6.97, lat: 38.88 }]
    updateTerraceNames(map, data, dots)
    updateTerraceNames(map, data, dots)
    expect(reads.height).toBe(1)
    expect(setFilter).toHaveBeenLastCalledWith(expect.any(String), [
      '!',
      ['in', ['get', 'id'], ['literal', ['d']]],
    ])
    // Shorter than 200 ÷ 0.35 px: the dot is near again.
    resize(500)
    updateTerraceNames(map, data, dots)
    expect(reads.height).toBe(2)
    expect(setFilter).toHaveBeenLastCalledWith(expect.any(String), null)
  })
})

describe('farShare', () => {
  it('hides nothing looking down and up to 40 % of the screen tilted', () => {
    expect(farShare(0)).toBe(0)
    expect(farShare(30)).toBe(0)
    expect(farShare(60)).toBeCloseTo(0.35)
    expect(farShare(85)).toBe(0.4)
  })
})

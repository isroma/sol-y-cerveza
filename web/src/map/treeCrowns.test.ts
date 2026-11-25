import { beforeEach, describe, expect, it, vi } from 'vitest'

const maplibre = vi.hoisted(() => ({
  addProtocol: vi.fn(),
  importScriptInWorkers: vi.fn<(url: string) => Promise<void>>(),
}))
vi.mock('maplibre-gl', () => maplibre)
vi.mock('./treesWorker.ts?worker&url', () => ({
  default: '/assets/treesWorker.js',
}))
vi.stubGlobal('location', { href: 'https://example.org/app/?shade=gpu' })

const { addTreeCrowns, TREE_LAYER, TREES, treesData } =
  await import('./treeCrowns.ts')
const { loadTrees, TREES_PROTOCOL } = await import('./treeCodec.ts')

function fakeMap() {
  const setData = vi.fn()
  return {
    setData,
    map: {
      addSource: vi.fn(),
      addLayer: vi.fn(),
      getSource: vi.fn(() => ({ setData })),
    },
  }
}

describe('addTreeCrowns', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds an empty source and the layer at once, before the given layer', () => {
    maplibre.importScriptInWorkers.mockReturnValue(new Promise(() => {}))
    const { map, setData } = fakeMap()
    addTreeCrowns(map, 'building-3d')
    expect(map.addSource).toHaveBeenCalledWith(TREES, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
    expect(map.addLayer).toHaveBeenCalledWith(TREE_LAYER, 'building-3d')
    expect(maplibre.addProtocol).toHaveBeenCalledWith(TREES_PROTOCOL, loadTrees)
    expect(setData).not.toHaveBeenCalled()
  })

  it('loads the data once the workers have the decoder', async () => {
    maplibre.importScriptInWorkers.mockResolvedValue()
    const { map, setData } = fakeMap()
    addTreeCrowns(map, undefined)
    expect(maplibre.importScriptInWorkers).toHaveBeenCalledWith(
      'https://example.org/assets/treesWorker.js#.mjs',
    )
    await vi.waitFor(() =>
      expect(setData).toHaveBeenCalledWith(
        treesData('https://example.org/app/?shade=gpu'),
      ),
    )
  })

  it('still loads the data (decoded on the main thread) if the workers fail', async () => {
    maplibre.importScriptInWorkers.mockRejectedValue(new Error('CSP'))
    const { map, setData } = fakeMap()
    addTreeCrowns(map, undefined)
    await vi.waitFor(() => expect(setData).toHaveBeenCalledOnce())
  })
})

describe('treesData', () => {
  it('is the data file, absolute and encoded, under the trees protocol', () => {
    expect(treesData('https://example.org/app/?shade=gpu')).toBe(
      'trees://https%3A%2F%2Fexample.org%2Fapp%2Fdata%2Ftrees.json',
    )
  })
})

describe('TREE_LAYER', () => {
  it('extrudes each band from its base to its top', () => {
    expect(TREE_LAYER.paint?.['fill-extrusion-base']).toEqual(['get', 'b'])
    expect(TREE_LAYER.paint?.['fill-extrusion-height']).toEqual(['get', 'h'])
  })
})

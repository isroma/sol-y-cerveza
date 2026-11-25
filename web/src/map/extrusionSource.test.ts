import { beforeEach, describe, expect, it, vi } from 'vitest'

const maplibre = vi.hoisted(() => ({
  addProtocol: vi.fn(),
  importScriptInWorkers: vi.fn<(url: string) => Promise<void>>(),
  GeoJSONSource: class {
    setData = vi.fn()
  },
}))
vi.mock('maplibre-gl', () => maplibre)
vi.mock('./extrusionWorker.ts?worker&url', () => ({
  default: '/assets/extrusionWorker.js',
}))
vi.stubGlobal('location', { href: 'https://example.org/app/?shade=gpu' })

const { addExtrusionSource, extrusionData } =
  await import('./extrusionSource.ts')
const { loadExtrusions, EXTRUSIONS_PROTOCOL } =
  await import('./extrusionCodec.ts')

function fakeMap() {
  const source = new maplibre.GeoJSONSource()
  const getSource = vi.fn()
  getSource.mockReturnValue(source)
  return {
    setData: source.setData,
    map: { addSource: vi.fn(), getSource },
  }
}

describe('addExtrusionSource', () => {
  beforeEach(() => vi.clearAllMocks())

  it('adds an empty source at once', () => {
    maplibre.importScriptInWorkers.mockReturnValue(new Promise(() => {}))
    const { map, setData } = fakeMap()
    addExtrusionSource(map, 'crowns', './data/trees.json')
    expect(map.addSource).toHaveBeenCalledWith('crowns', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
      maxzoom: 16,
    })
    expect(maplibre.addProtocol).toHaveBeenCalledWith(
      EXTRUSIONS_PROTOCOL,
      loadExtrusions,
    )
    expect(setData).not.toHaveBeenCalled()
  })

  it('loads the data once the workers have the decoder', async () => {
    maplibre.importScriptInWorkers.mockResolvedValue()
    const { map, setData } = fakeMap()
    addExtrusionSource(map, 'crowns', './data/trees.json')
    expect(maplibre.importScriptInWorkers).toHaveBeenCalledWith(
      'https://example.org/assets/extrusionWorker.js#.mjs',
    )
    await vi.waitFor(() =>
      expect(setData).toHaveBeenCalledWith(
        extrusionData(
          './data/trees.json',
          'https://example.org/app/?shade=gpu',
        ),
      ),
    )
  })

  it('still loads the data (decoded on the main thread) if the workers fail', async () => {
    maplibre.importScriptInWorkers.mockRejectedValue(new Error('CSP'))
    const { map, setData } = fakeMap()
    addExtrusionSource(map, 'crowns', './data/trees.json')
    await vi.waitFor(() => expect(setData).toHaveBeenCalledOnce())
  })
})

describe('extrusionData', () => {
  it('is the data file, absolute and encoded, under the extrusions protocol', () => {
    expect(
      extrusionData('./data/trees.json', 'https://example.org/app/?shade=gpu'),
    ).toBe('extrusions://https%3A%2F%2Fexample.org%2Fapp%2Fdata%2Ftrees.json')
  })
})

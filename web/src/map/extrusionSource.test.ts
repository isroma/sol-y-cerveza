import { beforeEach, describe, expect, it, vi } from 'vitest'

const maplibre = vi.hoisted(() => ({
  addProtocol: vi.fn(),
  importScriptInWorkers: vi.fn<(url: string) => Promise<void>>(),
  GeoJSONSource: class {
    listeners = new Set<() => void>()
    /** What setData does: load fine, or fire an error first. */
    fails = false
    setData = vi.fn(async () => {
      if (this.fails) for (const listener of this.listeners) listener()
    })
    on = (_type: string, listener: () => void) => this.listeners.add(listener)
    off = (_type: string, listener: () => void) =>
      this.listeners.delete(listener)
  },
}))
vi.mock('maplibre-gl', () => maplibre)
vi.mock('./extrusionWorker.ts?worker&url', () => ({
  default: '/assets/extrusionWorker.js',
}))
vi.stubGlobal('location', { href: 'https://example.org/app/' })

const { addExtrusionSource, extrusionData } =
  await import('./extrusionSource.ts')
const { loadExtrusions, EXTRUSIONS_PROTOCOL } =
  await import('./extrusionCodec.ts')

function fakeMap() {
  const source = new maplibre.GeoJSONSource()
  const getSource = vi.fn()
  getSource.mockReturnValue(source)
  return {
    source,
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
        extrusionData('./data/trees.json', 'https://example.org/app/'),
      ),
    )
  })

  it('still loads the data (decoded on the main thread) if the workers fail', async () => {
    maplibre.importScriptInWorkers.mockRejectedValue(new Error('CSP'))
    const { map, setData } = fakeMap()
    addExtrusionSource(map, 'crowns', './data/trees.json')
    await vi.waitFor(() => expect(setData).toHaveBeenCalledOnce())
  })

  it('resolves to whether the file loaded', async () => {
    maplibre.importScriptInWorkers.mockResolvedValue()
    const ok = fakeMap()
    await expect(
      addExtrusionSource(ok.map, 'crowns', './data/trees.json'),
    ).resolves.toBe(true)
    const missing = fakeMap()
    missing.source.fails = true
    await expect(
      addExtrusionSource(missing.map, 'crowns', './data/trees.json'),
    ).resolves.toBe(false)
    expect(missing.source.listeners.size).toBe(0)
  })
})

describe('extrusionData', () => {
  it('is the data file, absolute and encoded, under the extrusions protocol', () => {
    expect(extrusionData('./data/trees.json', 'https://example.org/app/')).toBe(
      'extrusions://https%3A%2F%2Fexample.org%2Fapp%2Fdata%2Ftrees.json',
    )
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeExtrusions, loadExtrusions } from './extrusionCodec.ts'

// Two crowns in one group (base 0, top 6) and one in another (4.5 to 11).
// Steps are in 1e-5°; each ring's first point steps from the previous ring's.
const FILE = {
  v: 1,
  g: [
    [0, 6, [[[-698660, 3886760, 2, 0, 0, 2]], [[10, 0, 1, 0, 0, 1]]]],
    [4.5, 11, [[[-5, -5, 3, 0, 0, 3, -3, 0]]]],
  ],
}

describe('decodeExtrusions', () => {
  it('turns the steps back into closed GeoJSON rings', () => {
    const { features } = decodeExtrusions(FILE)
    expect(features.map((f) => f.properties)).toEqual([
      { b: 0, h: 6 },
      { b: 0, h: 6 },
      { b: 4.5, h: 11 },
    ])
    expect(features[0]?.geometry.coordinates).toEqual([
      [
        [-6.9866, 38.8676],
        [-6.98658, 38.8676],
        [-6.98658, 38.86762],
        [-6.9866, 38.8676],
      ],
    ])
    expect(features[1]?.geometry.coordinates[0]?.[0]).toEqual([
      -6.9865, 38.8676,
    ])
    expect(features[2]?.geometry.coordinates[0]).toEqual([
      [-6.98655, 38.86755],
      [-6.98652, 38.86755],
      [-6.98652, 38.86758],
      [-6.98655, 38.86758],
      [-6.98655, 38.86755],
    ])
  })

  it('marks the crowns of groups flagged deciduous', () => {
    const { features } = decodeExtrusions({ ...FILE, d: [0, 1] })
    expect(features.map((f) => f.properties)).toEqual([
      { b: 0, h: 6 },
      { b: 0, h: 6 },
      { b: 4.5, h: 11, d: 1 },
    ])
  })

  it('rejects anything else, such as plain GeoJSON', () => {
    expect(() =>
      decodeExtrusions({ type: 'FeatureCollection', features: [] }),
    ).toThrow()
    expect(() =>
      decodeExtrusions({ v: 1, g: [[0, 6, [[[1.5, 2]]]]] }),
    ).toThrow()
  })
})

describe('loadExtrusions', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('fetches the encoded URL and returns GeoJSON', async () => {
    const fetch = vi.fn(
      async (_url: string) => new Response(JSON.stringify(FILE)),
    )
    vi.stubGlobal('fetch', fetch)
    const { data } = await loadExtrusions(
      { url: 'extrusions://https%3A%2F%2Fexample.org%2Fdata%2Ftrees.json' },
      new AbortController(),
    )
    expect(fetch.mock.calls[0]?.[0]).toBe('https://example.org/data/trees.json')
    expect(data.features).toHaveLength(3)
  })

  it('fails on an HTTP error', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }))
    await expect(
      loadExtrusions(
        { url: 'extrusions://https%3A%2F%2Fx%2Ft.json' },
        new AbortController(),
      ),
    ).rejects.toThrow('404')
  })
})

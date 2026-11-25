import type { StyleSpecification } from 'maplibre-gl'
import { describe, expect, it } from 'vitest'
import {
  dotStroke,
  loadOrthoPreference,
  ORTHO_MAX_ZOOM,
  orthoBeforeId,
  orthoLayer,
  orthoSource,
  saveOrthoPreference,
} from './ortho.ts'

function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, value),
  }
}

function throwingStorage(): Storage {
  const fail = () => {
    throw new Error('SecurityError')
  }
  return {
    length: 0,
    clear: fail,
    getItem: fail,
    key: fail,
    removeItem: fail,
    setItem: fail,
  }
}

describe('orthoSource', () => {
  it('asks IGN for PNOA MA Web Mercator tiles', () => {
    const [url] = orthoSource.tiles ?? []
    expect(url).toMatch(/^https:\/\/www\.ign\.es\/wmts\/pnoa-ma\?/)
    expect(url).toContain('layer=OI.OrthoimageCoverage')
    expect(url).toContain('tilematrixset=GoogleMapsCompatible')
    expect(url).toContain('tilematrix={z}&tilerow={y}&tilecol={x}')
  })

  it('stops fetching at the PNOA resolution, so deeper zooms overzoom', () => {
    expect(orthoSource.maxzoom).toBe(ORTHO_MAX_ZOOM)
    expect(ORTHO_MAX_ZOOM).toBeLessThan(21)
  })
})

describe('orthoLayer', () => {
  it('starts hidden or shown', () => {
    expect(orthoLayer(false).layout?.visibility).toBe('none')
    expect(orthoLayer(true).layout?.visibility).toBe('visible')
  })
})

describe('orthoBeforeId', () => {
  const style = (
    types: ('fill' | 'line' | 'symbol')[],
  ): StyleSpecification => ({
    version: 8,
    sources: { s: { type: 'vector' } },
    layers: types.map((type, i) => ({
      id: `l${i}`,
      type,
      source: 's',
      'source-layer': 'x',
    })),
  })

  it('goes under the first label, so street names stay on top', () => {
    expect(orthoBeforeId(style(['fill', 'line', 'symbol', 'line']))).toBe('l2')
  })

  it('goes on top of a style without labels', () => {
    expect(orthoBeforeId(style(['fill', 'line']))).toBeUndefined()
  })
})

describe('dotStroke', () => {
  it('rings the dots in white on the photo', () => {
    expect(dotStroke(true).color).toBe('#FFFFFF')
    expect(dotStroke(false).color).toBe('#3B3228')
  })
})

describe('the remembered choice', () => {
  it('round-trips', () => {
    const storage = memoryStorage()
    expect(loadOrthoPreference(storage)).toBe(false)
    saveOrthoPreference(true, storage)
    expect(loadOrthoPreference(storage)).toBe(true)
    saveOrthoPreference(false, storage)
    expect(loadOrthoPreference(storage)).toBe(false)
  })

  it('falls back to the flat map when storage throws', () => {
    const storage = throwingStorage()
    expect(() => saveOrthoPreference(true, storage)).not.toThrow()
    expect(loadOrthoPreference(storage)).toBe(false)
  })
})

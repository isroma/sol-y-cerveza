import { describe, expect, it } from 'vitest'
import { buildId, precacheList, workerScript } from './serviceWorker.ts'

describe('precacheList', () => {
  it('keeps the hashed build files, sorted, without source maps', () => {
    expect(
      precacheList([
        'index.html',
        'assets/MapView-b.js',
        'assets/index-a.js',
        'assets/index-a.js.map',
        'data/terraces.json',
      ]),
    ).toEqual(['assets/MapView-b.js', 'assets/index-a.js'])
  })
})

describe('buildId', () => {
  it('changes when any hashed file does', () => {
    const before = buildId(['assets/a-1.js', 'assets/b-1.js'])
    expect(buildId(['assets/a-1.js', 'assets/b-1.js'])).toBe(before)
    expect(buildId(['assets/a-1.js', 'assets/b-2.js'])).not.toBe(before)
    expect(before).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('workerScript', () => {
  const manifest = {
    build: 'abc',
    assets: ['assets/a.js'],
    pricesApi: null,
    basemapStyle: 'https://tiles.example/style',
  }

  it('prepends the manifest to a classic script', () => {
    const script = workerScript('self.skipWaiting();\nexport {};\n', manifest)
    expect(script).toBe(
      `const __SW_MANIFEST__ = ${JSON.stringify(manifest)};\nself.skipWaiting();\n`,
    )
  })

  it('refuses runtime imports', () => {
    expect(() =>
      workerScript('import { x } from "./x.js";\n', manifest),
    ).toThrow()
  })
})

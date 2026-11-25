import { describe, expect, it } from 'vitest'
import { buildId, precacheList, workerScript } from './serviceWorker.ts'

describe('precacheList', () => {
  const chunk = (
    fileName: string,
    imports: string[] = [],
    extra: { isEntry?: boolean; facadeModuleId?: string } = {},
  ) => ({
    type: 'chunk' as const,
    fileName,
    isEntry: extra.isEntry ?? false,
    facadeModuleId: extra.facadeModuleId ?? null,
    imports,
  })
  const asset = (fileName: string) => ({ type: 'asset' as const, fileName })
  const bundle = (...files: ReturnType<typeof chunk | typeof asset>[]) =>
    Object.fromEntries(files.map((file) => [file.fileName, file]))

  it('keeps the hashed build files, sorted, without source maps', () => {
    expect(
      precacheList(
        bundle(
          asset('index.html'),
          chunk('assets/MapView-b.js', [], {
            facadeModuleId: '/web/src/map/MapView.tsx',
          }),
          chunk('assets/index-a.js', [], { isEntry: true }),
          asset('assets/index-a.js.map'),
          asset('data/terraces.json'),
        ),
      ),
    ).toEqual(['assets/MapView-b.js', 'assets/index-a.js'])
  })

  it('takes the entry and map chunks, their static imports and all assets', () => {
    expect(
      precacheList(
        bundle(
          chunk('assets/index-a.js', ['assets/runtime-r.js'], {
            isEntry: true,
          }),
          chunk('assets/runtime-r.js'),
          chunk(
            'assets/MapView-b.js',
            ['assets/runtime-r.js', 'assets/geo-g.js'],
            {
              facadeModuleId: '/web/src/map/MapView.tsx',
            },
          ),
          chunk('assets/geo-g.js'),
          asset('assets/MapView-b.css'),
          asset('assets/maplibre-gl-worker-w.js'),
        ),
      ),
    ).toEqual([
      'assets/MapView-b.css',
      'assets/MapView-b.js',
      'assets/geo-g.js',
      'assets/index-a.js',
      'assets/maplibre-gl-worker-w.js',
      'assets/runtime-r.js',
    ])
  })

  it('leaves out chunks only dynamic imports reach (exifr for photos)', () => {
    expect(
      precacheList(
        bundle(
          chunk('assets/index-a.js', [], { isEntry: true }),
          chunk('assets/full.esm-e.js', ['assets/exif-dep-d.js']),
          chunk('assets/exif-dep-d.js'),
        ),
      ),
    ).toEqual(['assets/index-a.js'])
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

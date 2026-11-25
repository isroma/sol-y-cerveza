import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transformWithOxc, type Plugin } from 'vite'
import { BASEMAP_STYLE_URL } from '../src/config.ts'
import type { SwManifest } from '../sw/manifest.ts'

/** What precacheList needs to know about a file of the build's bundle. */
export type BundleFile =
  | {
      type: 'chunk'
      fileName: string
      isEntry: boolean
      facadeModuleId: string | null
      /** Static imports only; dynamic ones are in `dynamicImports`. */
      imports: readonly string[]
    }
  | { type: 'asset'; fileName: string }

/** The lazy map chunk (src/map/LazyMapView.tsx): every visitor loads it. */
const MAP_MODULE = '/src/map/MapView.tsx'

/**
 * The build's hashed files the worker precaches: the entry and map chunks
 * and what they statically import, plus every non-JavaScript file (CSS,
 * the MapLibre worker). Other chunks are only reachable through dynamic
 * imports off those paths, such as exifr for the owner's photo upload: the
 * worker fetches and caches them on first use instead (sw.ts cacheFirst).
 */
export function precacheList(bundle: Record<string, BundleFile>): string[] {
  const files = Object.values(bundle)
  const byName = new Map(files.map((file) => [file.fileName, file]))
  const reached = new Set<string>()
  const visit = (name: string) => {
    const file = byName.get(name)
    if (!file || reached.has(name)) return
    reached.add(name)
    if (file.type === 'chunk') file.imports.forEach(visit)
  }
  for (const file of files)
    if (
      file.type === 'asset' ||
      file.isEntry ||
      file.facadeModuleId?.endsWith(MAP_MODULE)
    )
      visit(file.fileName)
  return [...reached]
    .filter((name) => name.startsWith('assets/') && !name.endsWith('.map'))
    .sort()
}

/** Names the build's cache: changes whenever any hashed file does. */
export function buildId(assets: readonly string[]): string {
  return createHash('sha256')
    .update(assets.join('\n'))
    .digest('hex')
    .slice(0, 12)
}

/**
 * The worker as a classic script: type-stripped TypeScript with the manifest
 * in front. Classic, not a module worker, so every browser can run it; the
 * sources therefore must not import anything at runtime.
 */
export function workerScript(code: string, manifest: SwManifest): string {
  const body = code.replace(/^export \{\};?\s*$/m, '')
  if (/^\s*(import|export)\b/m.test(body))
    throw new Error('sw/*.ts must not import or export at runtime')
  return `const __SW_MANIFEST__ = ${JSON.stringify(manifest)};\n${body}`
}

/**
 * Emits dist/sw.js (sw/sw.ts, or sw/kill-switch.ts with
 * VITE_SW_KILL_SWITCH=1) with the precache list of this build. The app
 * registers it from src/registerServiceWorker.ts.
 */
export function serviceWorker(): Plugin {
  let env: Record<string, string | undefined> = {}
  let root = '.'
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      env = config.env
      root = config.root
    },
    async generateBundle(_options, bundle) {
      const killSwitch = env['VITE_SW_KILL_SWITCH'] === '1'
      const file = join(root, 'sw', killSwitch ? 'kill-switch.ts' : 'sw.ts')
      const assets = precacheList(bundle)
      const manifest: SwManifest = {
        build: buildId(assets),
        assets,
        pricesApi: env['VITE_PRICES_API'] || null,
        basemapStyle: BASEMAP_STYLE_URL,
      }
      const { code } = await transformWithOxc(
        await readFile(file, 'utf8'),
        file,
        { target: 'es2022' },
      )
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: workerScript(code, manifest),
      })
    },
  }
}

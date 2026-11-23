import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { transformWithOxc, type Plugin } from 'vite'
import { BASEMAP_STYLE_URL } from './src/config.ts'
import type { SwManifest } from './sw/manifest.ts'

/** The build's hashed files, the ones the worker precaches. */
export function precacheList(fileNames: Iterable<string>): string[] {
  return [...fileNames]
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
      const assets = precacheList(Object.keys(bundle))
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

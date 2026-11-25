import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MinimalPluginContextWithoutEnvironment,
  ViteDevServer,
} from 'vite'
import { describe, expect, it } from 'vitest'
import { reviewServer } from './reviewServer.ts'
import { ADMIN_ENDPOINTS, ADMIN_PREFIX } from './src/admin/endpoints.ts'

/** The paths the dev-server plugin mounts, in the order it mounts them. */
function mountedPaths(): string[] {
  const paths: string[] = []
  // Only what configureServer reads: the env dir (empty, so no .env.local)
  // and the middleware stack.
  const fake = {
    config: { mode: 'test', envDir: mkdtempSync(join(tmpdir(), 'admin-')) },
    middlewares: {
      use: (path: string) => {
        paths.push(path)
      },
    },
  }
  const hook = reviewServer().configureServer
  const configure = typeof hook === 'function' ? hook : hook?.handler
  if (!configure) throw new Error('reviewServer has no configureServer hook')
  // The hook reads nothing from its plugin context.
  void configure.call(
    {} as unknown as MinimalPluginContextWithoutEnvironment,
    fake as unknown as ViteDevServer,
  )
  return paths
}

describe('reviewServer routes', () => {
  const paths = mountedPaths()

  it('serves every endpoint the admin page names', () => {
    for (const path of Object.values(ADMIN_ENDPOINTS))
      expect(paths).toContain(path)
  })

  it('mounts nothing the admin page does not name, behind the guard', () => {
    expect(paths[0]).toBe(ADMIN_PREFIX)
    expect(paths.slice(1).sort()).toEqual(Object.values(ADMIN_ENDPOINTS).sort())
    for (const path of Object.values(ADMIN_ENDPOINTS))
      expect(path.startsWith(`${ADMIN_PREFIX}/`)).toBe(true)
  })

  it('mounts the photo endpoint before the prices one, which prefixes it', () => {
    expect(paths.indexOf(ADMIN_ENDPOINTS.pricePhoto)).toBeLessThan(
      paths.indexOf(ADMIN_ENDPOINTS.prices),
    )
  })
})

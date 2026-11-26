import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  MinimalPluginContextWithoutEnvironment,
  ViteDevServer,
} from 'vite'
import { describe, expect, it } from 'vitest'
import {
  addSunCorrections,
  readSunCorrections,
  reviewServer,
} from './reviewServer.ts'
import { ADMIN_ENDPOINTS, ADMIN_PREFIX } from '../../src/admin/endpoints.ts'

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

describe('sun_corrections.csv on disk', () => {
  const HEADER = 'id,venue_id,leaf_off,azimuth,altitude,seen'
  const row = (id: number, altitude = 27.1) => ({
    id,
    venueId: 'osm:node/123',
    leafOff: false,
    azimuth: 176.3,
    altitude,
    seen: '2026-11-25T12:31:04.000Z',
  })
  const fresh = () =>
    join(mkdtempSync(join(tmpdir(), 'sun-csv-')), 'sun_corrections.csv')

  it('creates the file with its header when it is missing', async () => {
    const path = fresh()
    expect(await readSunCorrections(path)).toEqual([])
    expect(await addSunCorrections(path, [])).toBe(0)
    expect(readFileSync(path, 'utf-8')).toBe(`${HEADER}\n`)
  })

  it('adds missing ids in order and never rewrites a row already there', async () => {
    const path = fresh()
    writeFileSync(
      path,
      `${HEADER}\n5,osm:node/9,1,10.0,5.0,2026-01-02T03:04:05.000Z\n`,
      'utf-8',
    )
    const before = statSync(path).mtimeMs
    expect(await addSunCorrections(path, [row(5)])).toBe(0)
    expect(statSync(path).mtimeMs).toBe(before)
    expect(await addSunCorrections(path, [row(12), row(5, 40), row(3)])).toBe(2)
    expect(readFileSync(path, 'utf-8')).toBe(
      [
        HEADER,
        '3,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z',
        '5,osm:node/9,1,10.0,5.0,2026-01-02T03:04:05.000Z',
        '12,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z',
        '',
      ].join('\n'),
    )
    expect((await readSunCorrections(path)).map((r) => r.id)).toEqual([
      3, 5, 12,
    ])
  })

  it('refuses to touch a file it cannot read', async () => {
    const path = fresh()
    writeFileSync(path, 'id,venue\n', 'utf-8')
    await expect(addSunCorrections(path, [row(1)])).rejects.toThrow(/header/)
    expect(readFileSync(path, 'utf-8')).toBe('id,venue\n')
  })
})

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
})

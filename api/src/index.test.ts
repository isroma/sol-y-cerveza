/**
 * The Worker end to end: src/index.ts bundled as for a deploy and run in workerd
 * (Miniflare), with a real local D1 that has every migration applied. Outbound
 * fetches (terraces.json, Turnstile siteverify, the Claude API) are stubbed, so no
 * test touches the network.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'
import {
  convertV4MiniflareOptions,
  Miniflare,
  Response as MfResponse,
  type Request as MfRequest,
  type RequestInit as MfRequestInit,
} from 'miniflare'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { DAILY_LIMIT, THRESHOLD, VENUE_HOURLY_LIMIT } from './logic.ts'
import { PHOTO_DAILY_LIMIT } from './photo.ts'

const ROOT = join(import.meta.dirname, '..')
const TEST_SECRET = '1x0000000000000000000000000000000AA'
const REAL_SECRET = '0x4AAAAAAAreal-looking-secret'
const SALT = 'a-long-enough-test-salt'
const ADMIN = 'Bearer test-admin-token'
const OWNER = 'Bearer test-owner-token'
const LOCAL = 'http://localhost:8787'
const DEPLOYED = 'https://sol-y-cerveza-api.example.workers.dev'
const ORIGINS = 'https://isroma.github.io,http://localhost:5173'
const TERRACES_URL = 'https://data.test/terraces.json'
/** Venues osm:node/1 … osm:node/40, all at one spot in Badajoz. */
const VENUES = Array.from({ length: 40 }, (_, i) => `osm:node/${i + 1}`)
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 0, 0x10))

let bundle = ''
let compatibilityDate = ''

/** One SQL statement per entry, comments removed (the migrations have no `;` in strings). */
function statements(sql: string): string[] {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
}

beforeAll(async () => {
  const toml = await readFile(join(ROOT, 'wrangler.toml'), 'utf8')
  compatibilityDate =
    /^compatibility_date\s*=\s*"([^"]+)"/m.exec(toml)?.[1] ?? ''
  const result = await build({
    entryPoints: [join(ROOT, 'src/index.ts')],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'esnext',
    conditions: ['workerd', 'worker', 'browser'],
    mainFields: ['browser', 'module', 'main'],
    write: false,
    logLevel: 'silent',
  })
  bundle = result.outputFiles[0]?.text ?? ''
})

type Calls = { siteverify: number; anthropic: number }

type Api = {
  /** Sends a request to the Worker; `path` is joined to `base`. */
  call: (
    path: string,
    init?: MfRequestInit & { ip?: string; base?: string },
  ) => Promise<MfResponse>
  sql: (query: string, ...params: unknown[]) => Promise<void>
  rows: <T>(query: string, ...params: unknown[]) => Promise<T[]>
  /** The GET /v1/prices answer in the Worker's Cache API, if any. */
  cachedPrices: () => Promise<MfResponse | undefined>
  calls: Calls
  dispose: () => Promise<void>
}

/** A fresh Worker and database. `bindings` overrides the secrets (undefined leaves one unset). */
async function startApi(
  bindings: Record<string, string | undefined> = {},
  /** Rows to insert just before the migration whose file name starts with `before`. */
  seed?: { before: string; sql: string[] },
): Promise<Api> {
  const calls: Calls = { siteverify: 0, anthropic: 0 }
  const secrets: Record<string, string> = {}
  const all = {
    TURNSTILE_SECRET: TEST_SECRET,
    ADMIN_TOKEN: 'test-admin-token',
    OWNER_TOKEN: 'test-owner-token',
    IP_SALT: SALT,
    ANTHROPIC_API_KEY: 'test-anthropic-key',
    ...bindings,
  }
  for (const [name, value] of Object.entries(all))
    if (value !== undefined) secrets[name] = value

  // The options as wrangler 4 writes them; this Miniflare takes them converted, as wrangler does.
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          name: 'api',
          modules: [{ type: 'ESModule', path: 'index.js', contents: bundle }],
          compatibilityDate,
          d1Databases: { DB: 'test-db' },
          bindings: { ALLOWED_ORIGINS: ORIGINS, TERRACES_URL, ...secrets },
          outboundService: async (request: MfRequest) => {
            const url = new URL(request.url)
            if (request.url === TERRACES_URL)
              return MfResponse.json({
                terraces: VENUES.map((id) => ({
                  id,
                  venue: { lat: 38.878, lon: -6.97 },
                })),
              })
            if (url.hostname === 'challenges.cloudflare.com') {
              calls.siteverify++
              const form = await request.formData()
              const token = String(form.get('response'))
              // A token "ok:<action>" passes as that action from the site's hostname.
              const [verdict, action] = token.split(':')
              return MfResponse.json({
                success: verdict === 'ok',
                hostname: 'isroma.github.io',
                action,
              })
            }
            if (url.hostname === 'api.anthropic.com') {
              calls.anthropic++
              return MfResponse.json({
                id: 'msg_test',
                type: 'message',
                role: 'assistant',
                model: 'claude-opus-5-5',
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({
                      prices: [
                        {
                          item: 'cana',
                          brand: null,
                          cents: 150,
                          label: 'Caña 1,50',
                          confidence: 'high',
                        },
                      ],
                      notes: [],
                      bar_name: 'Bar de Prueba',
                    }),
                  },
                ],
                stop_reason: 'end_turn',
                stop_sequence: null,
                usage: { input_tokens: 1, output_tokens: 1 },
              })
            }
            return new MfResponse(`unexpected fetch ${request.url}`, {
              status: 599,
            })
          },
        },
      ],
    }),
  )
  const db = await mf.getD1Database('DB')
  const migrations = (await readdir(join(ROOT, 'migrations')))
    .filter((f) => f.endsWith('.sql'))
    .sort()
  for (const file of migrations) {
    if (seed && file.startsWith(seed.before))
      await db.batch(seed.sql.map((s) => db.prepare(s)))
    const sql = await readFile(join(ROOT, 'migrations', file), 'utf8')
    await db.batch(statements(sql).map((s) => db.prepare(s)))
  }

  return {
    call: (path, init = {}) => {
      const { ip = '83.44.10.7', base = LOCAL, ...rest } = init
      const headers = new Headers(rest.headers)
      headers.set('CF-Connecting-IP', ip)
      return mf.dispatchFetch(`${base}${path}`, { ...rest, headers })
    },
    sql: async (query, ...params) => {
      await db
        .prepare(query)
        .bind(...params)
        .run()
    },
    rows: async <T>(query: string, ...params: unknown[]) =>
      (
        await db
          .prepare(query)
          .bind(...params)
          .all<T>()
      ).results,
    cachedPrices: async () =>
      (await mf.getCaches()).default.match(`${LOCAL}/v1/prices`),
    calls,
    dispose: () => mf.dispose(),
  }
}

/** A response's JSON as the shape the test expects; a wrong shape fails the assertions that follow. */
async function readJson<T>(response: MfResponse): Promise<T> {
  const body: unknown = await response.json()
  return body as T
}

function postJson(
  body: unknown,
  headers: Record<string, string> = {},
): MfRequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }
}

function suggestion(venueId: string, cents: number, token = 'ok:suggest') {
  return postJson({ venueId, item: 'cana', brand: null, cents, token })
}

/** An address on network number `n` (each its own /24). */
const netIp = (n: number) => `10.${Math.floor(n / 250)}.${n % 250}.1`

type Price = {
  venueId: string
  item: string
  brand: string | null
  cents: number
  confirmed: boolean
}

async function servedPrices(api: Api): Promise<Price[]> {
  const response = await api.call('/v1/prices')
  expect(response.status).toBe(200)
  const body = await readJson<{ prices: Price[] }>(response)
  return body.prices
}

/** A write that changes served prices purges the prices cache: an owner DELETE of nothing. */
async function purge(api: Api): Promise<void> {
  const response = await api.call('/v1/owner/prices', {
    method: 'DELETE',
    headers: { Authorization: OWNER, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      venueId: 'osm:node/40',
      item: 'cana',
      brand: null,
      cents: 100,
    }),
  })
  expect(response.status).toBe(200)
}

describe('the Worker on a migrated D1', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  it('stores a suggestion, and a re-vote replaces it', async () => {
    const venue = 'osm:node/1'
    expect(
      (await api.call('/v1/suggestions', suggestion(venue, 150))).status,
    ).toBe(201)
    expect(
      (await api.call('/v1/suggestions', suggestion(venue, 160))).status,
    ).toBe(201)
    const rows = await api.rows<{ cents: number; status: string }>(
      'SELECT cents, status FROM suggestions WHERE venue_id = ?',
      venue,
    )
    expect(rows).toEqual([{ cents: 160, status: 'pending' }])
  })

  it('refuses a failed bot check', async () => {
    const response = await api.call(
      '/v1/suggestions',
      suggestion('osm:node/1', 150, 'no:suggest'),
    )
    expect(response.status).toBe(403)
  })

  it(`caps one venue at ${VENUE_HOURLY_LIMIT} an hour, from everyone`, async () => {
    const venue = 'osm:node/2'
    for (let n = 0; n < VENUE_HOURLY_LIMIT; n++)
      expect(
        (
          await api.call('/v1/suggestions', {
            ...suggestion(venue, 150),
            ip: netIp(100 + n),
          })
        ).status,
      ).toBe(201)
    const response = await api.call('/v1/suggestions', {
      ...suggestion(venue, 150),
      ip: netIp(200),
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3600')
  })

  it(`caps one voter at ${DAILY_LIMIT} a day, across venues`, async () => {
    const ip = '91.1.1.1'
    for (let n = 0; n < DAILY_LIMIT; n++)
      expect(
        (
          await api.call('/v1/suggestions', {
            ...suggestion(VENUES[n + 3] ?? '', 150),
            ip,
          })
        ).status,
      ).toBe(201)
    const response = await api.call('/v1/suggestions', {
      ...suggestion('osm:node/30', 150),
      ip,
    })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('86400')
  })

  it('takes venue reports with the same guardrails', async () => {
    const report = postJson({
      kind: 'terrace',
      venueId: 'osm:node/3',
      terrace: true,
      token: 'ok:report',
    })
    expect(
      (await api.call('/v1/reports', { ...report, ip: '92.1.1.1' })).status,
    ).toBe(201)
    const wrongAction = postJson({
      kind: 'closed',
      venueId: 'osm:node/3',
      token: 'ok:suggest',
    })
    expect(
      (await api.call('/v1/reports', { ...wrongAction, ip: '92.1.1.1' }))
        .status,
    ).toBe(201)
    const queue = await api.call('/v1/admin/reports', {
      headers: { Authorization: ADMIN },
    })
    const body = await readJson<{ reports: unknown[] }>(queue)
    expect(body.reports).toHaveLength(2)
  })
})

describe('missing-venue reports', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const add = (lat: number, lon: number, n: number) =>
    api.call('/v1/reports', {
      ...postJson({
        kind: 'add',
        name: `Bar ${n}`,
        venueKind: 'bar',
        terrace: true,
        lat,
        lon,
        token: 'ok:report',
      }),
      ip: netIp(400 + n),
    })

  it(`are capped at ${VENUE_HOURLY_LIMIT} an hour per area, not across town`, async () => {
    for (let n = 0; n < VENUE_HOURLY_LIMIT; n++)
      expect((await add(38.878 + n * 0.0001, -6.97, n)).status).toBe(201)
    const sameArea = await add(38.8791, -6.9702, 100)
    expect(sameArea.status).toBe(429)
    expect(sameArea.headers.get('Retry-After')).toBe('3600')
    // About 3 km away: its own cap.
    expect((await add(38.9, -6.95, 101)).status).toBe(201)
    const queue = await api.call('/v1/admin/reports', {
      headers: { Authorization: ADMIN },
    })
    const body = await readJson<{ reports: { kind: string }[] }>(queue)
    expect(body.reports.filter((r) => r.kind === 'add')).toHaveLength(
      VENUE_HOURLY_LIMIT + 1,
    )
  })
})

describe('POST /v1/changes', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const change = (body: Record<string, unknown>, token = 'ok:change') =>
    postJson({ venueId: 'osm:node/5', token, ...body })

  it('stores a price, a move and closed behind one bot check', async () => {
    const before = api.calls.siteverify
    const response = await api.call('/v1/changes', {
      ...change({
        price: { item: 'cana', brand: null, cents: 150 },
        move: { lat: 38.8781, lon: -6.9701 },
        closed: true,
      }),
      ip: '93.1.1.1',
    })
    expect(response.status).toBe(201)
    expect(api.calls.siteverify - before).toBe(1)
    expect(
      await api.rows<{ cents: number }>(
        'SELECT cents FROM suggestions WHERE venue_id = ?',
        'osm:node/5',
      ),
    ).toEqual([{ cents: 150 }])
    expect(
      await api.rows<{ kind: string }>(
        'SELECT kind FROM venue_reports WHERE venue_id = ? ORDER BY kind',
        'osm:node/5',
      ),
    ).toEqual([{ kind: 'closed' }, { kind: 'move' }])
    // Each part counts towards the caps.
    expect(
      await api.rows<{ n: number }>(
        'SELECT COUNT(*) AS n FROM suggestion_events WHERE venue_id = ?',
        'osm:node/5',
      ),
    ).toEqual([{ n: 3 }])
  })

  it('stores nothing when one part is refused', async () => {
    const response = await api.call('/v1/changes', {
      ...change({
        venueId: 'osm:node/6',
        price: { item: 'cana', brand: null, cents: 150 },
        // About 1.1 km away: over the 500 m a move may go.
        move: { lat: 38.888, lon: -6.97 },
      }),
      ip: '93.1.1.2',
    })
    expect(response.status).toBe(400)
    expect(
      await api.rows(
        'SELECT 1 FROM suggestions WHERE venue_id = ?',
        'osm:node/6',
      ),
    ).toEqual([])
  })

  it('refuses a token made for another action, or a failed check', async () => {
    const real = await startApi({ TURNSTILE_SECRET: REAL_SECRET })
    try {
      const status = async (token: string) =>
        (
          await real.call('/v1/changes', {
            ...change({ closed: true }, token),
            base: DEPLOYED,
          })
        ).status
      expect(await status('ok:change')).toBe(201)
      expect(await status('ok:suggest')).toBe(403)
      expect(await status('no:change')).toBe(403)
    } finally {
      await real.dispose()
    }
  })

  it('refuses an unknown venue and an empty change', async () => {
    expect(
      (
        await api.call('/v1/changes', {
          ...change({ venueId: 'osm:node/999', closed: true }),
          ip: '93.1.1.4',
        })
      ).status,
    ).toBe(400)
    expect(
      (await api.call('/v1/changes', { ...change({}), ip: '93.1.1.4' })).status,
    ).toBe(400)
  })
})

describe('a rejected price', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const venue = 'osm:node/5'
  // The venue's hourly cap is tested above; here the log is cleared before each vote.
  const vote = async (n: number, cents = 150) => {
    await api.sql('DELETE FROM suggestion_events')
    return api.call('/v1/suggestions', {
      ...suggestion(venue, cents),
      ip: netIp(n),
    })
  }
  const resolve = (status: 'accepted' | 'rejected', cents = 150) =>
    api.call(
      '/v1/admin/resolve',
      postJson(
        { venueId: venue, item: 'cana', brand: null, cents, status },
        { Authorization: ADMIN },
      ),
    )
  const pendingCents = async () => {
    const response = await api.call('/v1/admin/suggestions', {
      headers: { Authorization: ADMIN },
    })
    const body = await readJson<{
      suggestions: { venue_id: string; cents: number }[]
    }>(response)
    return body.suggestions
      .filter((s) => s.venue_id === venue)
      .map((s) => s.cents)
  }
  const shown = async () =>
    (await servedPrices(api))
      .filter((p) => p.venueId === venue)
      .map((p) => p.cents)

  it(`is served once ${THRESHOLD} networks agree, and hidden once rejected`, async () => {
    for (let n = 0; n < THRESHOLD; n++) expect((await vote(n)).status).toBe(201)
    expect(await shown()).toEqual([150])
    expect(await (await resolve('rejected')).json()).toEqual({
      updated: THRESHOLD,
    })
    expect(await shown()).toEqual([])
    expect(await pendingCents()).toEqual([])
  })

  it('stays rejected when the same voters vote for it again', async () => {
    for (let n = 0; n < THRESHOLD; n++) expect((await vote(n)).status).toBe(201)
    await purge(api)
    expect(await shown()).toEqual([])
    expect(await pendingCents()).toEqual([])
  })

  it(`stays rejected when ${THRESHOLD} new networks vote for it`, async () => {
    for (let n = 50; n < 50 + THRESHOLD; n++)
      expect((await vote(n)).status).toBe(201)
    await purge(api)
    expect(await shown()).toEqual([])
    expect(await pendingCents()).toEqual([])
  })

  it('leaves other prices for the venue alone', async () => {
    for (let n = 60; n < 60 + THRESHOLD; n++)
      expect((await vote(n, 170)).status).toBe(201)
    await purge(api)
    expect(await shown()).toEqual([170])
    expect(await pendingCents()).toEqual([170])
  })

  it('comes back when the owner accepts it', async () => {
    expect((await resolve('accepted')).status).toBe(200)
    expect(await api.rows('SELECT * FROM rejected_prices')).toEqual([])
    // 10 networks now vote 150 (their rows are accepted) against 5 for 170.
    expect(await shown()).toEqual([150])
  })

  it('is lifted when the owner saves that price', async () => {
    expect((await resolve('rejected', 170)).status).toBe(200)
    expect(await api.rows('SELECT cents FROM rejected_prices')).toEqual([
      { cents: 170 },
    ])
    const save = await api.call('/v1/owner/prices', {
      method: 'PUT',
      headers: { Authorization: OWNER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venueId: venue,
        item: 'cana',
        brand: null,
        cents: 170,
      }),
    })
    expect(save.status).toBe(200)
    expect(await api.rows('SELECT * FROM rejected_prices')).toEqual([])
  })
})

describe('migration 0006', () => {
  it('carries over the prices rejected before it', async () => {
    const row = (ip: string, cents: number, status: string) =>
      `INSERT INTO suggestions (venue_id, item, brand, cents, ip_hash, net_hash, created_at, status)
       VALUES ('osm:node/7', 'cana', '', ${cents}, '${ip}', '${ip}', '2026-11-01T00:00:00Z', '${status}')`
    const api = await startApi(
      {},
      {
        before: '0006',
        sql: [
          row('a', 150, 'rejected'),
          row('b', 150, 'rejected'),
          row('c', 160, 'pending'),
        ],
      },
    )
    try {
      expect(
        await api.rows(
          'SELECT venue_id, item, brand, cents FROM rejected_prices',
        ),
      ).toEqual([
        { venue_id: 'osm:node/7', item: 'cana', brand: '', cents: 150 },
      ])
    } finally {
      await api.dispose()
    }
  })
})

describe('GET /v1/prices', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const ownerPut = (venueId: string, cents: number) =>
    api.call('/v1/owner/prices', {
      method: 'PUT',
      headers: { Authorization: OWNER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ venueId, item: 'cana', brand: null, cents }),
    })

  it('is cached, whatever the query string, and purged by an owner price', async () => {
    expect(await servedPrices(api)).toEqual([])
    await api.sql(
      "INSERT INTO owner_prices (venue_id, item, brand, cents, seen) VALUES ('osm:node/1', 'cana', '', 150, '2026-11-24')",
    )
    expect(await servedPrices(api)).toEqual([])
    const busted = await api.call('/v1/prices?nocache=1')
    expect(await busted.json()).toEqual({ prices: [] })

    expect((await ownerPut('osm:node/2', 160)).status).toBe(200)
    expect(
      (await servedPrices(api)).map((p) => [p.venueId, p.cents, p.confirmed]),
    ).toEqual([
      ['osm:node/1', 150, true],
      ['osm:node/2', 160, true],
    ])
  })

  it('is purged by an owner delete', async () => {
    const response = await api.call('/v1/owner/prices', {
      method: 'DELETE',
      headers: { Authorization: OWNER, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        venueId: 'osm:node/2',
        item: 'cana',
        brand: null,
        cents: 160,
      }),
    })
    expect(response.status).toBe(200)
    expect((await servedPrices(api)).map((p) => p.venueId)).toEqual([
      'osm:node/1',
    ])
  })

  it('keeps the answer in the Cache API without CORS headers, until a purge', async () => {
    await purge(api)
    expect(await api.cachedPrices()).toBeUndefined()
    const served = await api.call('/v1/prices?any=query', {
      headers: { Origin: 'https://isroma.github.io' },
    })
    const body: unknown = await served.json()
    // The cache is written after the response is sent (waitUntil).
    const cached = await vi.waitFor(async () => {
      const hit = await api.cachedPrices()
      if (!hit) throw new Error('not cached yet')
      return hit
    })
    expect(cached.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await cached.json()).toEqual(body)
    expect((await ownerPut('osm:node/3', 170)).status).toBe(200)
    expect(await api.cachedPrices()).toBeUndefined()
  })

  it('answers each allowed Origin with its own CORS header, cached or not', async () => {
    const get = (origin: string) =>
      api.call('/v1/prices', { headers: { Origin: origin } })
    const site = await get('https://isroma.github.io')
    expect(site.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://isroma.github.io',
    )
    expect(site.headers.get('Vary')).toBe('Origin')
    expect(site.headers.get('Cache-Control')).toBe('public, max-age=300')
    const local = await get('http://localhost:5173')
    expect(local.headers.get('Access-Control-Allow-Origin')).toBe(
      'http://localhost:5173',
    )
    const other = await get('https://evil.example')
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(other.status).toBe(200)
  })
})

describe('owner photos', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const photo = () =>
    api.call(
      '/v1/owner/photo',
      postJson(
        { image: JPEG, mediaType: 'image/jpeg' },
        { Authorization: OWNER },
      ),
    )

  it(`are read by the Claude API, at most ${PHOTO_DAILY_LIMIT} a day`, async () => {
    const first = await photo()
    expect(first.status).toBe(200)
    const body = await readJson<{ barName: string }>(first)
    expect(body.barName).toBe('Bar de Prueba')
    expect(api.calls.anthropic).toBe(1)

    // Readings older than a day don't count; the rest of today's fill the cap.
    const now = Date.now()
    await api.sql(
      'INSERT INTO owner_photo_events (at) VALUES (?)',
      new Date(now - 25 * 3600_000).toISOString(),
    )
    for (let i = 1; i < PHOTO_DAILY_LIMIT; i++)
      await api.sql(
        'INSERT INTO owner_photo_events (at) VALUES (?)',
        new Date(now - i * 1000).toISOString(),
      )

    const capped = await photo()
    expect(capped.status).toBe(429)
    expect(Number(capped.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(api.calls.anthropic).toBe(1)
  })

  it("don't use up the cap with an invalid photo", async () => {
    await api.sql('DELETE FROM owner_photo_events')
    const response = await api.call(
      '/v1/owner/photo',
      postJson(
        { image: JPEG, mediaType: 'image/png' },
        { Authorization: OWNER },
      ),
    )
    expect(response.status).toBe(415)
    expect(await api.rows('SELECT * FROM owner_photo_events')).toEqual([])
  })

  it('take a body over the 8 KB limit of the other routes', async () => {
    const image = `${JPEG.slice(0, 8)}${'A'.repeat(64 * 1024)}`
    const response = await api.call(
      '/v1/owner/photo',
      postJson({ image, mediaType: 'image/png' }, { Authorization: OWNER }),
    )
    expect(response.status).toBe(415)
  })

  it('refuse a body over the photo limit', async () => {
    // Streamed, with the byte that crosses the limit sent last: a refusal before the
    // whole body is sent would race the upload (EPIPE) and make the test flaky.
    const limit = 7 * 1024 * 1024
    const parts = [
      new Uint8Array(limit).fill(0x41),
      new Uint8Array(1).fill(0x41),
    ]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = parts.shift()
        if (next) controller.enqueue(next)
        else controller.close()
      },
    })
    const response = await api.call('/v1/owner/photo', {
      method: 'POST',
      headers: { Authorization: OWNER },
      body,
      duplex: 'half',
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'the photo is too large' })
  })
})

describe('tokens', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const routes: [string, string][] = [
    ['GET', '/v1/owner/check'],
    ['PUT', '/v1/owner/prices'],
    ['DELETE', '/v1/owner/prices'],
    ['POST', '/v1/owner/photo'],
    ['GET', '/v1/admin/suggestions'],
    ['POST', '/v1/admin/resolve'],
    ['GET', '/v1/admin/owner-prices'],
    ['GET', '/v1/admin/reports'],
    ['POST', '/v1/admin/reports/resolve'],
  ]

  it.each(routes)('%s %s needs the right token', async (method, path) => {
    const body = method === 'GET' ? undefined : '{}'
    expect((await api.call(path, { method, body })).status).toBe(401)
    expect(
      (
        await api.call(path, {
          method,
          body,
          headers: { Authorization: 'Bearer wrong' },
        })
      ).status,
    ).toBe(401)
    // The owner token opens no admin route, and the admin token no owner route.
    const other = path.startsWith('/v1/admin/') ? OWNER : ADMIN
    expect(
      (
        await api.call(path, {
          method,
          body,
          headers: { Authorization: other },
        })
      ).status,
    ).toBe(401)
  })

  it('accepts the owner token on its own route', async () => {
    expect(
      (await api.call('/v1/owner/check', { headers: { Authorization: OWNER } }))
        .status,
    ).toBe(200)
  })
})

describe('misconfiguration', () => {
  it.each([
    ['unset', undefined],
    ['too short', 'local-salt'],
  ])(
    'answers 503 where addresses are hashed when IP_SALT is %s',
    async (_, salt) => {
      const api = await startApi({ IP_SALT: salt })
      try {
        expect(
          (await api.call('/v1/suggestions', suggestion('osm:node/1', 150)))
            .status,
        ).toBe(503)
        const report = postJson({
          kind: 'closed',
          venueId: 'osm:node/1',
          token: 'ok:report',
        })
        expect((await api.call('/v1/reports', report)).status).toBe(503)
        expect(api.calls.siteverify).toBe(0)
        expect(await api.rows('SELECT * FROM suggestion_events')).toEqual([])
        expect((await api.call('/v1/prices')).status).toBe(200)
      } finally {
        await api.dispose()
      }
    },
  )

  it('fails the bot check when a Turnstile test secret reaches a deployed host', async () => {
    const api = await startApi({ TURNSTILE_SECRET: TEST_SECRET })
    try {
      const deployed = await api.call('/v1/suggestions', {
        ...suggestion('osm:node/1', 150),
        base: DEPLOYED,
      })
      expect(deployed.status).toBe(403)
      expect(api.calls.siteverify).toBe(0)
      // Local dev with .dev.vars test keys keeps working.
      expect(
        (await api.call('/v1/suggestions', suggestion('osm:node/1', 150)))
          .status,
      ).toBe(201)
      expect(
        (
          await api.call('/v1/suggestions', {
            ...suggestion('osm:node/1', 150),
            base: 'http://127.0.0.1:8787',
          })
        ).status,
      ).toBe(201)
    } finally {
      await api.dispose()
    }
  })

  it('checks the hostname and action with a real secret, on a deployed host', async () => {
    const api = await startApi({ TURNSTILE_SECRET: REAL_SECRET })
    try {
      const ok = await api.call('/v1/suggestions', {
        ...suggestion('osm:node/1', 150),
        base: DEPLOYED,
      })
      expect(ok.status).toBe(201)
      const wrongAction = await api.call('/v1/suggestions', {
        ...suggestion('osm:node/2', 150, 'ok:report'),
        base: DEPLOYED,
      })
      expect(wrongAction.status).toBe(403)
    } finally {
      await api.dispose()
    }
  })
})

describe('body size', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  it('refuses a declared Content-Length over the limit', async () => {
    const response = await api.call('/v1/suggestions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(8 * 1024 + 1),
      },
      body: 'x'.repeat(8 * 1024 + 1),
    })
    expect(response.status).toBe(413)
  })

  it('counts bytes, not characters', async () => {
    // 3000 "€" are 3000 UTF-16 units but 9000 bytes: over the 8 KB limit.
    const body = JSON.stringify({
      venueId: 'osm:node/1',
      item: 'cana',
      brand: null,
      cents: 150,
      token: '€'.repeat(3000),
    })
    expect(body.length).toBeLessThan(8 * 1024)
    expect(
      (await api.call('/v1/suggestions', { method: 'POST', body })).status,
    ).toBe(413)
  })

  it('bounds a streamed body with no Content-Length', async () => {
    // The byte that crosses the limit goes last, so the refusal can't race the upload.
    const parts = [
      new Uint8Array(4096).fill(0x78),
      new Uint8Array(4096).fill(0x78),
      new Uint8Array(1).fill(0x78),
    ]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = parts.shift()
        if (next) controller.enqueue(next)
        else controller.close()
      },
    })
    const response = await api.call('/v1/reports', {
      method: 'POST',
      body,
      duplex: 'half',
    })
    expect(response.status).toBe(413)
  })

  it('applies the same limit to the admin routes', async () => {
    for (const path of ['/v1/admin/resolve', '/v1/admin/reports/resolve']) {
      const response = await api.call(path, {
        method: 'POST',
        headers: { Authorization: ADMIN },
        body: JSON.stringify({
          ids: [1],
          status: 'rejected',
          pad: 'x'.repeat(9000),
        }),
      })
      expect(response.status).toBe(413)
    }
  })

  it('still reads a normal body', async () => {
    const response = await api.call(
      '/v1/admin/reports/resolve',
      postJson({ ids: [1], status: 'rejected' }, { Authorization: ADMIN }),
    )
    expect(response.status).toBe(200)
  })
})

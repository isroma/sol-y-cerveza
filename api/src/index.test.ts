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
import {
  DAILY_LIMIT,
  LOGIN_HOURLY_LIMIT,
  LOGIN_NETWORK_LIMIT,
  madridDate,
  THRESHOLD,
  VENUE_HOURLY_LIMIT,
} from './logic.ts'
import { DELETE_OPEN_REPORT } from './reports.ts'
import { horizonBin, isLeafOff, SUN_THRESHOLD } from './sun.ts'
import { getPosition } from 'suncalc'

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

/** The spot on a 10° grid where the sun's altitude now is nearest `degrees`. */
function spotWithSunAt(degrees: number): { lat: number; lon: number } {
  const now = new Date()
  let best = { lat: 0, lon: 0 }
  let bestGap = Infinity
  for (let lat = -60; lat <= 60; lat += 10)
    for (let lon = -180; lon < 180; lon += 10) {
      const gap = Math.abs(getPosition(now, lat, lon).altitude - degrees)
      if (gap < bestGap) [best, bestGap] = [{ lat, lon }, gap]
    }
  return best
}

/**
 * Sun reports depend on where the sun is when the Worker gets them, so these
 * venues are placed, whatever the time the tests run, where the sun is 45° up
 * (and moves slowly), where it is far below the horizon, and nowhere.
 */
const SUNNY = 'osm:node/901'
const DARK = 'osm:node/902'
const NOWHERE = 'osm:node/903'
const SUNNY_SPOT = spotWithSunAt(45)
const SUN_VENUES = [
  { id: SUNNY, venue: SUNNY_SPOT },
  { id: DARK, venue: spotWithSunAt(-60) },
  { id: NOWHERE },
]

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

type Calls = { siteverify: number }

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
  const calls: Calls = { siteverify: 0 }
  const secrets: Record<string, string> = {}
  const all = {
    TURNSTILE_SECRET: TEST_SECRET,
    ADMIN_TOKEN: 'test-admin-token',
    OWNER_TOKEN: 'test-owner-token',
    OWNER_USERNAME: 'dueño',
    OWNER_PASSWORD: 'una contraseña larga',
    IP_SALT: SALT,
    ...bindings,
  }
  for (const [name, value] of Object.entries(all))
    if (value !== undefined) secrets[name] = value

  const outbound = async (request: MfRequest) => {
    const url = new URL(request.url)
    if (request.url === TERRACES_URL)
      return MfResponse.json({
        terraces: [
          ...VENUES.map((id) => ({
            id,
            venue: { lat: 38.878, lon: -6.97 },
          })),
          ...SUN_VENUES,
        ],
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
    return new MfResponse(`unexpected fetch ${request.url}`, {
      status: 599,
    })
  }

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
          outboundService: outbound,
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

  it("replaces a voter's open report of the same kind, through the unique index", async () => {
    const answer = (terrace: boolean) =>
      api.call('/v1/reports', {
        ...postJson({
          kind: 'terrace',
          venueId: 'osm:node/4',
          terrace,
          token: 'ok:report',
        }),
        ip: '92.2.2.2',
      })
    expect((await answer(true)).status).toBe(201)
    expect((await answer(false)).status).toBe(201)
    const open = await api.rows<{ terrace: number }>(
      `SELECT terrace FROM venue_reports
       WHERE status = 'pending' AND kind = 'terrace' AND venue_id = 'osm:node/4'`,
    )
    expect(open).toEqual([{ terrace: 0 }])
    const plan = await api.rows<{ detail: string }>(
      `EXPLAIN QUERY PLAN ${DELETE_OPEN_REPORT}`,
      'terrace',
      'osm:node/4',
      'x',
    )
    expect(plan.map((row) => row.detail).join('\n')).toContain(
      'USING INDEX venue_reports_one_open',
    )
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

  it('stores a terrace answer and a tables pin, and a resend replaces them', async () => {
    const send = (body: Record<string, unknown>) =>
      api.call('/v1/changes', {
        ...change({ venueId: 'osm:node/9', ...body }),
        ip: '93.1.1.5',
      })
    const open = () =>
      api.rows<{ kind: string; terrace: number | null; lat: number | null }>(
        `SELECT kind, terrace, lat FROM venue_reports
         WHERE status = 'pending' AND venue_id = ? ORDER BY kind`,
        'osm:node/9',
      )
    const events = async () =>
      (
        await api.rows<{ n: number }>(
          'SELECT COUNT(*) AS n FROM suggestion_events WHERE venue_id = ?',
          'osm:node/9',
        )
      )[0]?.n
    const before = api.calls.siteverify
    expect(
      (await send({ terrace: true, pin: { lat: 38.8781, lon: -6.9701 } }))
        .status,
    ).toBe(201)
    expect(api.calls.siteverify - before).toBe(1)
    expect(await open()).toEqual([
      { kind: 'pin', terrace: null, lat: 38.8781 },
      { kind: 'terrace', terrace: 1, lat: null },
    ])
    // Each part is its own event for the caps.
    expect(await events()).toBe(2)
    // A new answer or pin from the same voter replaces the open one.
    expect((await send({ pin: { lat: 38.8782, lon: -6.9702 } })).status).toBe(
      201,
    )
    expect((await send({ terrace: false })).status).toBe(201)
    expect(await open()).toEqual([
      { kind: 'pin', terrace: null, lat: 38.8782 },
      { kind: 'terrace', terrace: 0, lat: null },
    ])
    expect(await events()).toBe(4)
  })

  it('refuses a pin with no terrace, or too far away, storing nothing', async () => {
    const send = (body: Record<string, unknown>) =>
      api.call('/v1/changes', {
        ...change({
          venueId: 'osm:node/10',
          price: { item: 'cana', brand: null, cents: 150 },
          ...body,
        }),
        ip: '93.1.1.6',
      })
    const contradiction = await send({
      terrace: false,
      pin: { lat: 38.8781, lon: -6.9701 },
    })
    expect(contradiction.status).toBe(400)
    expect(await readJson<{ error: string }>(contradiction)).toEqual({
      error: 'invalid pin with no terrace',
    })
    // About 220 m away: over the 150 m a pin may go.
    const far = await send({ terrace: true, pin: { lat: 38.88, lon: -6.97 } })
    expect(far.status).toBe(400)
    expect(await readJson<{ error: string }>(far)).toEqual({
      error: 'invalid position',
    })
    for (const table of ['suggestions', 'venue_reports', 'suggestion_events'])
      expect(
        await api.rows(
          `SELECT 1 FROM ${table} WHERE venue_id = ?`,
          'osm:node/10',
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

describe('caps under parallel requests', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const statuses = async (requests: Promise<MfResponse>[]) =>
    (await Promise.all(requests)).map((r) => r.status).sort()
  const expected = (passed: number, total: number) => [
    ...Array<number>(passed).fill(201),
    ...Array<number>(total - passed).fill(429),
  ]

  it(`lets one voter's parallel suggestions through only up to ${DAILY_LIMIT}`, async () => {
    const ip = '94.1.1.1'
    const sent = DAILY_LIMIT + 10
    expect(
      await statuses(
        VENUES.slice(0, sent).map((venue) =>
          api.call('/v1/suggestions', { ...suggestion(venue, 150), ip }),
        ),
      ),
    ).toEqual(expected(DAILY_LIMIT, sent))
    expect(await api.rows('SELECT COUNT(*) AS n FROM suggestions')).toEqual([
      { n: DAILY_LIMIT },
    ])
    expect(
      await api.rows('SELECT COUNT(*) AS n FROM suggestion_events'),
    ).toEqual([{ n: DAILY_LIMIT }])
  })

  it(`lets one voter's parallel reports into the queue only up to ${DAILY_LIMIT}`, async () => {
    const ip = '94.2.1.1'
    const sent = DAILY_LIMIT + 5
    expect(
      await statuses(
        VENUES.slice(0, sent).map((venueId) =>
          api.call('/v1/reports', {
            ...postJson({ kind: 'closed', venueId, token: 'ok:report' }),
            ip,
          }),
        ),
      ),
    ).toEqual(expected(DAILY_LIMIT, sent))
    expect(await api.rows('SELECT COUNT(*) AS n FROM venue_reports')).toEqual([
      { n: DAILY_LIMIT },
    ])
  })

  it(`lets one venue take only ${VENUE_HOURLY_LIMIT} parallel suggestions`, async () => {
    const venue = 'osm:node/35'
    const sent = VENUE_HOURLY_LIMIT + 5
    expect(
      await statuses(
        Array.from({ length: sent }, (_, n) =>
          api.call('/v1/suggestions', {
            ...suggestion(venue, 150),
            ip: netIp(300 + n),
          }),
        ),
      ),
    ).toEqual(expected(VENUE_HOURLY_LIMIT, sent))
  })

  it('takes every part of a change from the allowance, or none', async () => {
    const ip = '94.3.1.1'
    for (let n = 0; n < DAILY_LIMIT - 2; n++)
      expect(
        (
          await api.call('/v1/suggestions', {
            ...suggestion(VENUES[n] ?? '', 150),
            ip,
          })
        ).status,
      ).toBe(201)
    const change = (body: Record<string, unknown>) =>
      api.call('/v1/changes', {
        ...postJson({ venueId: 'osm:node/36', token: 'ok:change', ...body }),
        ip,
      })
    // Three parts would go past the cap: refused, and nothing is logged or stored.
    const over = await change({
      price: { item: 'cana', brand: null, cents: 150 },
      move: { lat: 38.8781, lon: -6.9701 },
      closed: true,
    })
    expect(over.status).toBe(429)
    // So would a terrace answer and a pin with a price.
    const terraceOver = await change({
      price: { item: 'cana', brand: null, cents: 150 },
      terrace: true,
      pin: { lat: 38.8781, lon: -6.9701 },
    })
    expect(terraceOver.status).toBe(429)
    expect(
      await api.rows(
        'SELECT 1 FROM venue_reports WHERE venue_id = ?',
        'osm:node/36',
      ),
    ).toEqual([])
    expect(over.status).toBe(429)
    expect(over.headers.get('Retry-After')).toBe('86400')
    expect(
      await api.rows(
        'SELECT COUNT(*) AS n FROM suggestion_events WHERE venue_id = ?',
        'osm:node/36',
      ),
    ).toEqual([{ n: 0 }])
    // Two parts fill it exactly.
    expect(
      (
        await change({
          price: { item: 'cana', brand: null, cents: 150 },
          closed: true,
        })
      ).status,
    ).toBe(201)
    expect(
      await api.rows(
        'SELECT COUNT(*) AS n FROM suggestion_events WHERE venue_id = ?',
        'osm:node/36',
      ),
    ).toEqual([{ n: 2 }])
    expect((await change({ closed: true })).status).toBe(429)
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

describe('GET /v1/version', () => {
  it('reports the build it was deployed with, never cached, with CORS', async () => {
    const api = await startApi({ BUILD_ID: '0123456789abcdef0123456789abcdef' })
    try {
      const response = await api.call('/v1/version', {
        headers: { Origin: 'https://isroma.github.io' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://isroma.github.io',
      )
      expect(await response.json()).toEqual({
        build: '0123456789abcdef0123456789abcdef',
      })
      expect((await api.call('/v1/version', { method: 'POST' })).status).toBe(
        404,
      )
    } finally {
      await api.dispose()
    }
  })

  it('reports null when deployed without a build', async () => {
    const api = await startApi()
    try {
      const response = await api.call('/v1/version')
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({ build: null })
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

describe('owner changes', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  type Queued = { kind: string; owner: boolean; ids: number[] }
  const queue = async () =>
    (
      await readJson<{ reports: Queued[] }>(
        await api.call('/v1/admin/reports', {
          headers: { Authorization: ADMIN },
        }),
      )
    ).reports

  it('save a price at once and queue a move and closed as the owner’s, with no bot check', async () => {
    const before = api.calls.siteverify
    const response = await api.call(
      '/v1/owner/changes',
      postJson(
        {
          venueId: 'osm:node/7',
          price: { item: 'cana', brand: null, cents: 180 },
          move: { lat: 38.8781, lon: -6.9701 },
          closed: true,
        },
        { Authorization: OWNER },
      ),
    )
    expect(response.status).toBe(201)
    expect(api.calls.siteverify).toBe(before)
    expect(
      (await servedPrices(api))
        .filter((p) => p.venueId === 'osm:node/7')
        .map((p) => [p.cents, p.confirmed]),
    ).toEqual([[180, true]])
    const reports = await queue()
    expect(reports.map((r) => [r.kind, r.owner])).toEqual(
      expect.arrayContaining([
        ['move', true],
        ['closed', true],
      ]),
    )
    // The owner's come first, for the admin to apply.
    expect(reports[0]?.owner).toBe(true)
  })

  it('queue a terrace answer and a tables pin as the owner’s', async () => {
    const send = (body: Record<string, unknown>) =>
      api.call(
        '/v1/owner/changes',
        postJson({ venueId: 'osm:node/11', ...body }, { Authorization: OWNER }),
      )
    expect(
      (await send({ terrace: true, pin: { lat: 38.8781, lon: -6.9701 } }))
        .status,
    ).toBe(201)
    // A second one replaces the owner's open pin, as a visitor's would.
    expect((await send({ pin: { lat: 38.8782, lon: -6.9702 } })).status).toBe(
      201,
    )
    expect(
      await api.rows(
        `SELECT kind, terrace, lat, by_owner FROM venue_reports
         WHERE status = 'pending' AND venue_id = ? ORDER BY kind`,
        'osm:node/11',
      ),
    ).toEqual([
      { kind: 'pin', terrace: null, lat: 38.8782, by_owner: 1 },
      { kind: 'terrace', terrace: 1, lat: null, by_owner: 1 },
    ])
    expect(
      (await send({ terrace: false, pin: { lat: 38.8781, lon: -6.9701 } }))
        .status,
    ).toBe(400)
  })

  it('add a missing venue as the owner’s', async () => {
    const response = await api.call(
      '/v1/owner/reports',
      postJson(
        {
          kind: 'add',
          name: 'Bar Nuevo',
          venueKind: 'bar',
          terrace: true,
          lat: 38.879,
          lon: -6.971,
        },
        { Authorization: OWNER },
      ),
    )
    expect(response.status).toBe(201)
    expect((await queue()).some((r) => r.kind === 'add' && r.owner)).toBe(true)
  })

  it('refuse an unknown venue or a move too far away', async () => {
    const send = (body: Record<string, unknown>) =>
      api.call('/v1/owner/changes', postJson(body, { Authorization: OWNER }))
    expect((await send({ venueId: 'osm:node/999', closed: true })).status).toBe(
      400,
    )
    expect(
      (await send({ venueId: 'osm:node/7', move: { lat: 38.9, lon: -6.9 } }))
        .status,
    ).toBe(400)
    expect((await send({ venueId: 'osm:node/7' })).status).toBe(400)
  })

  it('leave visitor reports for review', async () => {
    const visitor = await api.call('/v1/changes', {
      ...postJson({ venueId: 'osm:node/8', closed: true, token: 'ok:change' }),
      ip: '92.9.9.9',
    })
    expect(visitor.status).toBe(201)
    expect(
      (await queue()).find((r) => r.kind === 'closed' && !r.owner),
    ).toBeDefined()
  })
})

describe('owner login', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  const attempt = (password: string, ip = '93.1.1.1', username = 'dueño') =>
    api.call('/v1/login', { ...postJson({ username, password }), ip })

  it('hands out the owner token for the right username and password', async () => {
    const response = await attempt('una contraseña larga')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: 'test-owner-token' })
  })

  it('answers a wrong username or password alike', async () => {
    expect((await attempt('nope', '93.2.2.2')).status).toBe(401)
    expect(
      (await attempt('una contraseña larga', '93.2.2.2', 'otro')).status,
    ).toBe(401)
  })

  it(`allows ${LOGIN_NETWORK_LIMIT} attempts per network, and a good login gives them back`, async () => {
    for (let i = 0; i < LOGIN_NETWORK_LIMIT - 1; i++)
      expect((await attempt('nope', '93.3.3.3')).status).toBe(401)
    expect((await attempt('una contraseña larga', '93.3.3.3')).status).toBe(200)
    for (let i = 0; i < LOGIN_NETWORK_LIMIT; i++)
      expect((await attempt('nope', '93.3.3.3')).status).toBe(401)
    const blocked = await attempt('una contraseña larga', '93.3.3.3')
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('900')
    // Another network still gets in.
    expect((await attempt('una contraseña larga', '93.4.4.4')).status).toBe(200)
  })

  it(`stops everyone after ${LOGIN_HOURLY_LIMIT} attempts in an hour`, async () => {
    await api.sql('DELETE FROM login_attempts')
    const now = new Date().toISOString()
    for (let i = 0; i < LOGIN_HOURLY_LIMIT; i++)
      await api.sql(
        'INSERT INTO login_attempts (net_hash, at) VALUES (?, ?)',
        `other-${i}`,
        now,
      )
    expect((await attempt('una contraseña larga', '93.5.5.5')).status).toBe(429)
  })

  it('is off until the username and password are set', async () => {
    const bare = await startApi({ OWNER_PASSWORD: undefined })
    try {
      const response = await bare.call(
        '/v1/login',
        postJson({ username: 'dueño', password: 'x' }),
      )
      expect(response.status).toBe(503)
    } finally {
      await bare.dispose()
    }
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
    ['POST', '/v1/owner/changes'],
    ['POST', '/v1/owner/reports'],
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

describe('sun reports', () => {
  let api: Api
  beforeAll(async () => {
    api = await startApi()
  })
  afterAll(() => api.dispose())

  type Correction = {
    venueId: string
    leafOff: boolean
    from: number
    to: number
    altitude: number
    confirmed: boolean
    reporters: number
  }
  type Queued = {
    ids: number[]
    venueId: string
    reporters: number
    shown: boolean
    sightings: { azimuth: number; altitude: number }[]
  }
  type Stored = {
    id: number
    azimuth: number
    altitude: number
    bin: number
    leaf_off: number
    status: string
    by_owner: number
  }

  const sunNow = (venueId: string, ip: string, extra = {}) =>
    api.call('/v1/changes', {
      ...postJson({ venueId, token: 'ok:change', sun: true, ...extra }),
      ip,
    })
  const corrections = async () => {
    const response = await api.call('/v1/sun')
    expect(response.status).toBe(200)
    return (await readJson<{ corrections: Correction[] }>(response)).corrections
  }
  const queue = async () =>
    (
      await readJson<{ reports: Queued[] }>(
        await api.call('/v1/admin/sun', { headers: { Authorization: ADMIN } }),
      )
    ).reports
  const resolve = (ids: number[], status: string) =>
    api.call(
      '/v1/admin/sun/resolve',
      postJson({ ids, status }, { Authorization: ADMIN }),
    )
  const stored = (venueId: string) =>
    api.rows<Stored>(
      'SELECT id, azimuth, altitude, bin, leaf_off, status, by_owner FROM sun_reports WHERE venue_id = ? ORDER BY id',
      venueId,
    )
  /**
   * Puts every SUNNY report where the first one is: the sun moves a little
   * between requests, which could split a run at a tenth of a degree or a bin.
   */
  const align = () =>
    api.sql(
      `UPDATE sun_reports SET (azimuth, altitude, bin) =
         (SELECT azimuth, altitude, bin FROM sun_reports WHERE venue_id = ?1 ORDER BY id LIMIT 1)
       WHERE venue_id = ?1`,
      SUNNY,
    )
  const events = async (venueId: string) =>
    (
      await api.rows<{ n: number }>(
        'SELECT COUNT(*) AS n FROM suggestion_events WHERE venue_id = ?',
        venueId,
      )
    )[0]?.n

  it('stores where the sun is, by the server, and replaces a re-report', async () => {
    const response = await sunNow(SUNNY, '94.1.1.1')
    expect(response.status).toBe(201)
    const sun = getPosition(new Date(), SUNNY_SPOT.lat, SUNNY_SPOT.lon)
    const [report] = await stored(SUNNY)
    expect(report?.altitude).toBeCloseTo(sun.altitude, 0)
    expect(report?.azimuth).toBeCloseTo(sun.azimuth, 0)
    expect(report?.bin).toBe(horizonBin(report?.azimuth ?? NaN))
    expect(report?.leaf_off).toBe(Number(isLeafOff(madridDate(new Date()))))
    expect(report?.status).toBe('pending')
    expect(await events(SUNNY)).toBe(1)

    expect((await sunNow(SUNNY, '94.1.1.1')).status).toBe(201)
    expect((await stored(SUNNY)).length).toBe(1)
    expect(await events(SUNNY)).toBe(2)
  })

  it('stores a sun report with a price, as one change', async () => {
    const response = await sunNow(SUNNY, '94.1.1.2', {
      price: { item: 'cana', brand: null, cents: 150 },
    })
    expect(response.status).toBe(201)
    expect(
      await api.rows('SELECT 1 FROM suggestions WHERE venue_id = ?', SUNNY),
    ).toHaveLength(1)
    expect(await stored(SUNNY)).toHaveLength(2)
    expect(await events(SUNNY)).toBe(4)
  })

  it('refuses the sun when it is down, a venue without a position and a bad part, storing nothing', async () => {
    const down = await sunNow(DARK, '94.1.1.3', {
      price: { item: 'cana', brand: null, cents: 150 },
    })
    expect(down.status).toBe(400)
    expect(await down.json()).toEqual({ error: 'sun is down' })
    expect(
      await api.rows('SELECT 1 FROM suggestions WHERE venue_id = ?', DARK),
    ).toEqual([])
    expect(await stored(DARK)).toEqual([])
    expect(await events(DARK)).toBe(0)

    const nowhere = await sunNow(NOWHERE, '94.1.1.3')
    expect(nowhere.status).toBe(400)
    expect(await stored(NOWHERE)).toEqual([])

    const bad = await sunNow(SUNNY, '94.1.1.3', { sun: 'yes' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid sun' })
  })

  it(`serves a correction once ${SUN_THRESHOLD} networks agree, and queues them`, async () => {
    expect(SUN_THRESHOLD).toBe(3)
    // One network so far: 94.1.1.1 and 94.1.1.2 are two voters on one /24.
    expect((await sunNow(SUNNY, '94.2.2.2')).status).toBe(201)
    const pendingBefore = await queue()
    expect(pendingBefore.map((q) => [q.venueId, q.reporters, q.shown])).toEqual(
      [[SUNNY, 2, false]],
    )
    expect((await sunNow(SUNNY, '94.3.3.3')).status).toBe(201)
    await align()
    const served = await corrections()
    expect(served.map((c) => [c.venueId, c.confirmed, c.reporters])).toEqual([
      [SUNNY, false, 3],
    ])
    const [run] = served
    const [first] = await stored(SUNNY)
    expect(run?.from).toBe(((first?.bin ?? 0) + 355) % 360)
    expect(run?.to).toBe(((first?.bin ?? 0) + 5) % 360)
    expect(run?.leafOff).toBe(isLeafOff(madridDate(new Date())))
    const [entry] = await queue()
    expect(entry?.reporters).toBe(3)
    expect(entry?.ids).toHaveLength(4)
    expect(entry?.shown).toBe(true)
    expect(entry?.sightings[0]?.altitude).toBeCloseTo(45, -1)
  })

  it('stops serving rejected reports, and keeps the slice blocked for new networks', async () => {
    const [entry] = await queue()
    const response = await resolve(entry?.ids ?? [], 'rejected')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(await corrections()).toEqual([])
    expect(await queue()).toEqual([])
    expect(
      await api.rows('SELECT 1 FROM sun_rejections WHERE venue_id = ?', SUNNY),
    ).not.toHaveLength(0)

    for (const ip of ['94.4.4.4', '94.5.5.5', '94.6.6.6'])
      expect((await sunNow(SUNNY, ip)).status).toBe(201)
    await align()
    // A resolve of nothing purges the cache.
    expect((await resolve([999_999], 'accepted')).status).toBe(200)
    expect(await corrections()).toEqual([])
    expect((await queue()).map((q) => [q.reporters, q.shown])).toEqual([
      [3, false],
    ])
  })

  it('confirms accepted reports', async () => {
    const [entry] = await queue()
    expect((await resolve(entry?.ids ?? [], 'accepted')).status).toBe(200)
    expect(
      (await corrections()).map((c) => [c.venueId, c.confirmed, c.reporters]),
    ).toEqual([[SUNNY, true, 3]])
    expect(await queue()).toEqual([])
  })

  it('stores the owner’s as accepted and serves it at once', async () => {
    const owner = (venueId: string) =>
      api.call(
        '/v1/owner/changes',
        postJson({ venueId, sun: true }, { Authorization: OWNER }),
      )
    const down = await owner(DARK)
    expect(down.status).toBe(400)
    expect(await down.json()).toEqual({ error: 'sun is down' })
    expect((await owner(SUNNY)).status).toBe(201)
    await align()
    const mine = (await stored(SUNNY)).filter((r) => r.by_owner === 1)
    expect(mine.map((r) => r.status)).toEqual(['accepted'])
    // The owner's write purged the cache: the confirmed run counts them too.
    expect(
      (await corrections()).map((c) => [c.confirmed, c.reporters]),
    ).toEqual([[true, 4]])
    expect(await queue()).toEqual([])
  })

  it('lists the accepted reports in the window for the admin’s CSV', async () => {
    // An accepted report from before the window is left out.
    await api.sql(
      `INSERT INTO sun_reports
         (venue_id, azimuth, altitude, bin, leaf_off, voter_hash, net_hash, created_at, status)
       VALUES (?, 180, 30, 180, 0, 'v', 'n', '2020-01-01T00:00:00.000Z', 'accepted')`,
      SUNNY,
    )
    const response = await api.call('/v1/admin/sun/accepted', {
      headers: { Authorization: ADMIN },
    })
    expect(response.status).toBe(200)
    const { reports } = await readJson<{
      reports: {
        id: number
        venueId: string
        leafOff: boolean
        azimuth: number
        altitude: number
        at: string
      }[]
    }>(response)
    const accepted = (await stored(SUNNY)).filter(
      (r) => r.status === 'accepted',
    )
    expect(accepted).toHaveLength(5)
    expect(reports.map((r) => r.id)).toEqual(
      accepted.slice(0, 4).map((r) => r.id),
    )
    const [first] = reports
    expect(first?.venueId).toBe(SUNNY)
    expect(first?.leafOff).toBe(isLeafOff(madridDate(new Date())))
    expect(first?.azimuth).toBe(
      Math.round((accepted[0]?.azimuth ?? 0) * 10) / 10,
    )
    expect(first?.altitude).toBe(
      Math.round((accepted[0]?.altitude ?? 0) * 10) / 10,
    )
    expect(first?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })

  it('caches GET /v1/sun like prices and keeps the admin routes behind the token', async () => {
    const response = await api.call('/v1/sun?nocache=1')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300')
    expect((await api.call('/v1/admin/sun')).status).toBe(401)
    expect((await api.call('/v1/admin/sun/accepted')).status).toBe(401)
    expect(
      (
        await api.call(
          '/v1/admin/sun/resolve',
          postJson({ ids: [1], status: 'maybe' }, { Authorization: ADMIN }),
        )
      ).status,
    ).toBe(400)
  })
})

describe('usage counters', () => {
  type CountRow = { day: string; name: string; value: string; count: number }

  /** A beacon as the app sends it: a JSON string as text/plain, no preflight. */
  function beacon(events: unknown, headers: Record<string, string> = {}) {
    return {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', ...headers },
      body: JSON.stringify({ events }),
    }
  }

  it('counts allowed events per Madrid day and drops the rest, without IP_SALT or a bot check', async () => {
    const api = await startApi({ IP_SALT: undefined })
    try {
      const response = await api.call(
        '/v1/events',
        beacon(
          [
            { name: 'open', value: 'phone' },
            { name: 'venue_open', value: 'osm:node/1' },
            { name: 'venue_open', value: 'osm:node/1' },
            { name: 'venue_open', value: 'osm:node/999' },
            { name: 'time_change', value: '13' },
            { name: 'search', value: 'the text typed' },
            { name: 'nope' },
          ],
          { Origin: 'https://isroma.github.io' },
        ),
      )
      expect(response.status).toBe(204)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
        'https://isroma.github.io',
      )
      expect(
        (
          await api.call(
            '/v1/events',
            postJson({ events: [{ name: 'open', value: 'phone' }] }),
          )
        ).status,
      ).toBe(204)
      const day = madridDate(new Date())
      expect(
        await api.rows<CountRow>(
          'SELECT day, name, value, count FROM event_counts ORDER BY name, value',
        ),
      ).toEqual([
        { day, name: 'open', value: 'phone', count: 2 },
        { day, name: 'time_change', value: '13', count: 1 },
        { day, name: 'venue_open', value: 'osm:node/1', count: 2 },
      ])
      expect(api.calls.siteverify).toBe(0)
    } finally {
      await api.dispose()
    }
  })

  it('refuses a malformed or oversized body', async () => {
    const api = await startApi()
    try {
      const call = (init: MfRequestInit) => api.call('/v1/events', init)
      expect((await call(beacon('open'))).status).toBe(400)
      expect(
        (
          await call(
            beacon(Array.from({ length: 21 }, () => ({ name: 'locate' }))),
          )
        ).status,
      ).toBe(400)
      expect(
        (await call({ method: 'POST', body: '{"events": [' })).status,
      ).toBe(400)
      expect(
        (await call(beacon([{ name: 'locate', value: 'x'.repeat(5000) }])))
          .status,
      ).toBe(413)
      expect(await api.rows('SELECT * FROM event_counts')).toEqual([])
    } finally {
      await api.dispose()
    }
  })

  it('serves the counters to the admin token only, newest day first', async () => {
    const api = await startApi()
    try {
      const today = madridDate(new Date())
      await api.sql(
        `INSERT INTO event_counts (day, name, value, count) VALUES
         ('2000-01-01', 'open', 'phone', 9), (?, 'open', 'desktop', 3),
         (?, 'locate', '', 1), ('2000-01-02', 'locate', '', 4)`,
        today,
        today,
      )
      expect((await api.call('/v1/admin/stats')).status).toBe(401)
      const response = await api.call('/v1/admin/stats?days=7', {
        headers: { Authorization: ADMIN },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toEqual({
        rows: [
          { day: today, name: 'locate', value: '', count: 1 },
          { day: today, name: 'open', value: 'desktop', count: 3 },
        ],
      })
    } finally {
      await api.dispose()
    }
  })
})

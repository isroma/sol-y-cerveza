/**
 * Price suggestions API (Cloudflare Worker + D1).
 *
 * - POST /v1/suggestions: a visitor suggests a price. Turnstile-verified (our
 *   hostname and action), one vote per voter (salted hash of the IPv4 address
 *   or IPv6 /64) per venue, item and brand, daily caps per voter and per
 *   network, an hourly cap per venue, plausible prices only, and only for
 *   venues in the data.
 * - GET /v1/prices: prices at least THRESHOLD networks agree on (shown with "~").
 * - GET /v1/admin/suggestions, POST /v1/admin/resolve: the review queue,
 *   for the local admin view only (bearer ADMIN_TOKEN).
 * - Owner mode (bearer OWNER_TOKEN, which can only add or remove prices):
 *   GET /v1/owner/check, PUT/DELETE /v1/owner/prices saves a confirmed price,
 *   POST /v1/owner/photo reads prices and the bar's name from a photo.
 * - GET /v1/admin/owner-prices: owner prices, for the admin's import.
 * - POST /v1/reports: a visitor reports a venue that moved, closed or is missing,
 *   whether it has a terrace, or where the terrace is (ADR-0009), with the same
 *   identity and caps as suggestions. Never applied automatically.
 * - GET /v1/admin/reports, POST /v1/admin/reports/resolve: the reports queue.
 */
import {
  allowedOrigin,
  consensus,
  EVENT_RETENTION_HOURS,
  isTestSecret,
  limitHit,
  madridDate,
  parseOwnerPrice,
  parseSuggestion,
  safeEqual,
  TURNSTILE_ACTION,
  turnstilePassed,
  voterKeys,
  WINDOW_DAYS,
  withOwnerPrices,
  type OwnerRow,
  type PriceGroup,
} from './logic.ts'
import { parsePhoto, PhotoError, readPhoto } from './photo.ts'
import {
  distanceMetres,
  maxDistance,
  NEW_VENUE_KEY,
  parseReport,
  parseResolution,
  REPORT_TURNSTILE_ACTION,
  reportQueue,
  type LatLon,
  type ReportRow,
} from './reports.ts'

type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  TURNSTILE_SECRET: string
  ADMIN_TOKEN: string
  IP_SALT: string
  OWNER_TOKEN: string
  AI: Ai
}

const MAX_BODY = 8 * 1024
/** A downscaled photo (about 0.5 MB) as base64, with room to spare. */
const MAX_PHOTO_BODY = 7 * 1024 * 1024

let venues: { ids: Map<string, LatLon>; until: number } | null = null

/** Venue ids in the published data and each venue's position, cached for an hour per isolate. */
async function knownVenues(env: Env): Promise<Map<string, LatLon>> {
  if (venues && venues.until > Date.now()) return venues.ids
  const response = await fetch(env.TERRACES_URL, { cf: { cacheTtl: 3600 } })
  if (!response.ok) throw new Error(`terraces.json: HTTP ${response.status}`)
  const data: unknown = await response.json()
  const records =
    typeof data === 'object' && data !== null && 'terraces' in data && Array.isArray(data.terraces)
      ? data.terraces
      : []
  const ids = new Map<string, LatLon>()
  for (const record of records)
    if (typeof record === 'object' && record !== null && typeof record.id === 'string') {
      const venue: unknown = record.venue
      const position =
        typeof venue === 'object' &&
        venue !== null &&
        'lat' in venue &&
        'lon' in venue &&
        typeof venue.lat === 'number' &&
        typeof venue.lon === 'number'
          ? { lat: venue.lat, lon: venue.lon }
          : { lat: NaN, lon: NaN }
      ids.set(record.id, position)
    }
  venues = { ids, until: Date.now() + 3600_000 }
  return ids
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function turnstileOk(env: Env, token: string, ip: string, action: string): Promise<boolean> {
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  form.append('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const result: unknown = await response.json()
  return turnstilePassed(result, env.ALLOWED_ORIGINS, isTestSecret(env.TURNSTILE_SECRET), action)
}

const LIMIT_MESSAGES = {
  voter: 'too many suggestions today',
  network: 'too many suggestions from this network today',
  venue: 'too many suggestions for this venue right now, try later',
} as const

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A small JSON body, or the error response to send. */
async function smallBody(request: Request): Promise<{ body: unknown } | Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  try {
    return { body: JSON.parse(text) }
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
}

/** The salted voter and network hashes of a request's address. */
async function identity(env: Env, ip: string): Promise<{ voterHash: string; netHash: string }> {
  const keys = voterKeys(ip)
  return {
    voterHash: await sha256(`${env.IP_SALT}:${keys.voter}`),
    netHash: await sha256(`${env.IP_SALT}:net:${keys.network}`),
  }
}

/** The 429 to send when a voter, network or venue key is over its cap, or null. */
async function overCap(
  env: Env,
  voterHash: string,
  netHash: string,
  venueKey: string,
  now: number,
): Promise<Response | null> {
  const dayAgo = new Date(now - 86400_000).toISOString()
  const hourAgo = new Date(now - 3600_000).toISOString()
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM suggestion_events WHERE voter_hash = ?1 AND at >= ?4) AS voter,
       (SELECT COUNT(*) FROM suggestion_events WHERE net_hash = ?2 AND at >= ?4) AS network,
       (SELECT COUNT(*) FROM suggestion_events WHERE venue_id = ?3 AND at >= ?5) AS venue`,
  )
    .bind(voterHash, netHash, venueKey, dayAgo, hourAgo)
    .first<{ voter: number; network: number; venue: number }>()
  const hit = limitHit(counts ?? { voter: 0, network: 0, venue: 0 })
  if (!hit) return null
  return json({ error: LIMIT_MESSAGES[hit] }, 429, {
    'Retry-After': hit === 'venue' ? '3600' : '86400',
  })
}

/** Logs a request against the caps and prunes the log. */
function logEvent(env: Env, voterHash: string, netHash: string, venueKey: string, now: number) {
  const pruneBefore = new Date(now - EVENT_RETENTION_HOURS * 3600_000).toISOString()
  return [
    env.DB.prepare(
      'INSERT INTO suggestion_events (voter_hash, net_hash, venue_id, at) VALUES (?, ?, ?, ?)',
    ).bind(voterHash, netHash, venueKey, new Date(now).toISOString()),
    env.DB.prepare('DELETE FROM suggestion_events WHERE at < ?').bind(pruneBefore),
  ]
}

async function suggest(request: Request, env: Env): Promise<Response> {
  const read = await smallBody(request)
  if (read instanceof Response) return read
  const parsed = parseSuggestion(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await turnstileOk(env, parsed.token, ip, TURNSTILE_ACTION))) return json({ error: 'bot check failed' }, 403)
  if (!(await knownVenues(env)).has(parsed.value.venueId))
    return json({ error: 'unknown venue' }, 400)

  const { voterHash, netHash } = await identity(env, ip)
  const { venueId, item, brand, cents } = parsed.value
  const now = Date.now()
  const capped = await overCap(env, voterHash, netHash, venueId, now)
  if (capped) return capped

  const at = new Date(now).toISOString()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO suggestions (venue_id, item, brand, cents, ip_hash, net_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (ip_hash, venue_id, item, brand)
       DO UPDATE SET cents = excluded.cents, net_hash = excluded.net_hash,
                     created_at = excluded.created_at, status = 'pending'`,
    ).bind(venueId, item, brand ?? '', cents, voterHash, netHash, at),
    ...logEvent(env, voterHash, netHash, venueId, now),
  ])
  return json({ ok: true }, 201)
}

async function report(request: Request, env: Env): Promise<Response> {
  const read = await smallBody(request)
  if (read instanceof Response) return read
  const parsed = parseReport(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await turnstileOk(env, parsed.token, ip, REPORT_TURNSTILE_ACTION)))
    return json({ error: 'bot check failed' }, 403)
  const value = parsed.value
  const venueKey = value.kind === 'add' ? NEW_VENUE_KEY : value.venueId
  if (value.kind !== 'add') {
    const published = (await knownVenues(env)).get(value.venueId)
    if (!published) return json({ error: 'unknown venue' }, 400)
    // A NaN position (a record without `venue`) is never within range.
    const limit = maxDistance(value)
    if (limit !== null && 'lat' in value && !(distanceMetres(published, value) <= limit))
      return json({ error: 'invalid position' }, 400)
  }

  const { voterHash, netHash } = await identity(env, ip)
  const now = Date.now()
  const capped = await overCap(env, voterHash, netHash, venueKey, now)
  if (capped) return capped

  const venueId = value.kind === 'add' ? '' : value.venueId
  const replaced =
    value.kind === 'add'
      ? []
      : [
          env.DB.prepare(
            `DELETE FROM venue_reports
             WHERE status = 'pending' AND kind = ? AND venue_id = ? AND voter_hash = ?`,
          ).bind(value.kind, venueId, voterHash),
        ]
  await env.DB.batch([
    ...replaced,
    env.DB.prepare(
      `INSERT INTO venue_reports
         (kind, venue_id, name, venue_kind, lat, lon, terrace, voter_hash, net_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      value.kind,
      venueId,
      value.kind === 'add' ? value.name : '',
      value.kind === 'add' ? value.venueKind : '',
      'lat' in value ? value.lat : null,
      'lon' in value ? value.lon : null,
      'terrace' in value ? Number(value.terrace) : null,
      voterHash,
      netHash,
      new Date(now).toISOString(),
    ),
    ...logEvent(env, voterHash, netHash, venueKey, now),
  ])
  return json({ ok: true }, 201)
}

async function pendingReports(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, venue_id, name, venue_kind, lat, lon, terrace, net_hash, created_at
     FROM venue_reports WHERE status = 'pending'`,
  ).all<ReportRow>()
  return json({ reports: reportQueue(results) }, 200)
}

async function resolveReports(request: Request, env: Env): Promise<Response> {
  const resolution = parseResolution(await request.json().catch(() => null))
  if (!resolution) return json({ error: 'invalid resolution' }, 400)
  const result = await env.DB.prepare(
    `UPDATE venue_reports SET status = ?
     WHERE status = 'pending' AND id IN (SELECT value FROM json_each(?))`,
  )
    .bind(resolution.status, JSON.stringify(resolution.ids))
    .run()
  return json({ updated: result.meta.changes }, 200)
}

async function prices(env: Env): Promise<Response> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()
  const { results } = await env.DB.prepare(
    `SELECT venue_id, item, brand, cents, COUNT(DISTINCT net_hash) AS voters,
            MAX(created_at) AS last
     FROM suggestions
     WHERE status != 'rejected' AND created_at >= ?
     GROUP BY venue_id, item, brand, cents`,
  )
    .bind(since)
    .all<PriceGroup>()
  const owner = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices',
  ).all<OwnerRow>()
  return json({ prices: withOwnerPrices(consensus(results), owner.results) }, 200, {
    'Cache-Control': 'public, max-age=300',
  })
}

async function pending(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT venue_id, item, brand, cents, COUNT(DISTINCT net_hash) AS voters,
            MAX(created_at) AS last
     FROM suggestions WHERE status = 'pending'
     GROUP BY venue_id, item, brand, cents
     ORDER BY voters DESC, last DESC`,
  ).all<PriceGroup>()
  return json({ suggestions: results }, 200)
}

async function resolve(request: Request, env: Env): Promise<Response> {
  const body: unknown = await request.json().catch(() => null)
  if (typeof body !== 'object' || body === null) return json({ error: 'body' }, 400)
  const { venueId, item, brand, cents, status } = body as Record<string, unknown>
  if (
    typeof venueId !== 'string' ||
    typeof item !== 'string' ||
    (brand !== null && typeof brand !== 'string') ||
    typeof cents !== 'number' ||
    (status !== 'accepted' && status !== 'rejected')
  )
    return json({ error: 'invalid resolution' }, 400)
  const result = await env.DB.prepare(
    `UPDATE suggestions SET status = ?
     WHERE status = 'pending' AND venue_id = ? AND item = ? AND brand = ? AND cents = ?`,
  )
    .bind(status, venueId, item, brand ?? '', cents)
    .run()
  return json({ updated: result.meta.changes }, 200)
}

async function ownerPrice(request: Request, env: Env): Promise<Response> {
  const parsed = parseOwnerPrice(await request.json().catch(() => null))
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const { venueId, item, brand, cents } = parsed.value
  if (!(await knownVenues(env)).has(venueId)) return json({ error: 'unknown venue' }, 400)
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM owner_prices WHERE venue_id = ? AND item = ? AND brand = ?')
      .bind(venueId, item, brand ?? '')
      .run()
    return json({ ok: true }, 200)
  }
  const seen = madridDate(new Date())
  await env.DB.prepare(
    `INSERT INTO owner_prices (venue_id, item, brand, cents, seen) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (venue_id, item, brand) DO UPDATE SET cents = excluded.cents, seen = excluded.seen`,
  )
    .bind(venueId, item, brand ?? '', cents, seen)
    .run()
  return json({ ok: true, seen }, 200)
}

async function ownerPhoto(request: Request, env: Env): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_PHOTO_BODY) return json({ error: 'the photo is too large' }, 413)
  try {
    const photo = parsePhoto(JSON.parse(text))
    return json(await readPhoto(env.AI, photo), 200)
  } catch (error) {
    if (error instanceof PhotoError) return json({ error: error.message }, error.status)
    if (error instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400)
    throw error
  }
}

async function ownerPrices(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices ORDER BY venue_id, item, brand',
  ).all<OwnerRow>()
  return json({ prices: results }, 200)
}

function bearer(request: Request, token: string): boolean {
  return Boolean(token) && safeEqual(request.headers.get('Authorization') ?? '', `Bearer ${token}`)
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/v1/prices' && request.method === 'GET') return prices(env)
  if (pathname === '/v1/suggestions' && request.method === 'POST') return suggest(request, env)
  if (pathname === '/v1/reports' && request.method === 'POST') return report(request, env)
  if (pathname.startsWith('/v1/owner/')) {
    if (!bearer(request, env.OWNER_TOKEN)) return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/owner/check' && request.method === 'GET') return json({ ok: true }, 200)
    if (pathname === '/v1/owner/prices' && (request.method === 'PUT' || request.method === 'DELETE'))
      return ownerPrice(request, env)
    if (pathname === '/v1/owner/photo' && request.method === 'POST') return ownerPhoto(request, env)
  }
  if (pathname.startsWith('/v1/admin/')) {
    if (!bearer(request, env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/admin/owner-prices' && request.method === 'GET') return ownerPrices(env)
    if (pathname === '/v1/admin/suggestions' && request.method === 'GET') return pending(env)
    if (pathname === '/v1/admin/resolve' && request.method === 'POST') return resolve(request, env)
    if (pathname === '/v1/admin/reports' && request.method === 'GET') return pendingReports(env)
    if (pathname === '/v1/admin/reports/resolve' && request.method === 'POST')
      return resolveReports(request, env)
  }
  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request.headers.get('Origin'), env.ALLOWED_ORIGINS)
    const cors: Record<string, string> = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          Vary: 'Origin',
        }
      : {}
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    let response: Response
    try {
      response = await route(request, env)
    } catch (error) {
      console.error(error)
      response = json({ error: 'server error' }, 500)
    }
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value)
    return response
  },
} satisfies ExportedHandler<Env>

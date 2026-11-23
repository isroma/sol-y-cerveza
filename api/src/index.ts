/**
 * Price suggestions API (Cloudflare Worker + D1).
 *
 * - POST /v1/suggestions: a visitor suggests a price. Turnstile-verified,
 *   one vote per person (salted IP hash) per venue, item and brand, a daily
 *   cap per person, plausible prices only, and only for venues in the data.
 * - GET /v1/prices: prices at least THRESHOLD people agree on (shown with "~").
 * - GET /v1/admin/suggestions, POST /v1/admin/resolve: the review queue,
 *   for the local admin view only (bearer ADMIN_TOKEN).
 * - Owner mode (bearer OWNER_TOKEN, which can only add or remove prices):
 *   GET /v1/owner/check, PUT/DELETE /v1/owner/prices saves a confirmed price,
 *   POST /v1/owner/photo reads prices and the bar's name from a photo.
 * - GET /v1/admin/owner-prices: owner prices, for the admin's import.
 */
import {
  allowedOrigin,
  consensus,
  DAILY_LIMIT,
  madridDate,
  parseOwnerPrice,
  parseSuggestion,
  safeEqual,
  WINDOW_DAYS,
  withOwnerPrices,
  type OwnerRow,
  type PriceGroup,
} from './logic.ts'
import { parsePhoto, PhotoError, readPhoto } from './photo.ts'

type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  TURNSTILE_SECRET: string
  ADMIN_TOKEN: string
  IP_SALT: string
  OWNER_TOKEN: string
  ANTHROPIC_API_KEY: string
}

const MAX_BODY = 8 * 1024
/** A downscaled photo (about 0.5 MB) as base64, with room to spare. */
const MAX_PHOTO_BODY = 7 * 1024 * 1024

let venues: { ids: Set<string>; until: number } | null = null

/** Venue ids in the published data, cached for an hour per isolate. */
async function knownVenues(env: Env): Promise<Set<string>> {
  if (venues && venues.until > Date.now()) return venues.ids
  const response = await fetch(env.TERRACES_URL, { cf: { cacheTtl: 3600 } })
  if (!response.ok) throw new Error(`terraces.json: HTTP ${response.status}`)
  const data: unknown = await response.json()
  const records =
    typeof data === 'object' && data !== null && 'terraces' in data && Array.isArray(data.terraces)
      ? data.terraces
      : []
  const ids = new Set<string>()
  for (const record of records)
    if (typeof record === 'object' && record !== null && typeof record.id === 'string')
      ids.add(record.id)
  venues = { ids, until: Date.now() + 3600_000 }
  return ids
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function turnstileOk(env: Env, token: string, ip: string): Promise<boolean> {
  const form = new FormData()
  form.append('secret', env.TURNSTILE_SECRET)
  form.append('response', token)
  form.append('remoteip', ip)
  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body: form,
  })
  const result: unknown = await response.json()
  return typeof result === 'object' && result !== null && 'success' in result && result.success === true
}

function json(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

async function suggest(request: Request, env: Env): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'too large' }, 413)
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const parsed = parseSuggestion(body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await turnstileOk(env, parsed.token, ip))) return json({ error: 'bot check failed' }, 403)
  if (!(await knownVenues(env)).has(parsed.value.venueId))
    return json({ error: 'unknown venue' }, 400)

  const ipHash = await sha256(`${env.IP_SALT}:${ip}`)
  const since = new Date(Date.now() - 86400_000).toISOString()
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM suggestions WHERE ip_hash = ? AND created_at >= ?',
  )
    .bind(ipHash, since)
    .first<{ n: number }>()
  if ((recent?.n ?? 0) >= DAILY_LIMIT) return json({ error: 'too many suggestions today' }, 429)

  const { venueId, item, brand, cents } = parsed.value
  await env.DB.prepare(
    `INSERT INTO suggestions (venue_id, item, brand, cents, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (ip_hash, venue_id, item, brand)
     DO UPDATE SET cents = excluded.cents, created_at = excluded.created_at, status = 'pending'`,
  )
    .bind(venueId, item, brand ?? '', cents, ipHash, new Date().toISOString())
    .run()
  return json({ ok: true }, 201)
}

async function prices(env: Env): Promise<Response> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString()
  const { results } = await env.DB.prepare(
    `SELECT venue_id, item, brand, cents, COUNT(DISTINCT ip_hash) AS voters,
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
    `SELECT venue_id, item, brand, cents, COUNT(*) AS voters, MAX(created_at) AS last
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
    return json(await readPhoto(env.ANTHROPIC_API_KEY, photo), 200)
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

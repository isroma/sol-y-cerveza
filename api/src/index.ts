/**
 * Price suggestions API (Cloudflare Worker + D1).
 *
 * - POST /v1/suggestions: a visitor suggests a price. Turnstile-verified,
 *   one vote per person (salted IP hash) per venue, item and brand, a daily
 *   cap per person, plausible prices only, and only for venues in the data.
 * - GET /v1/prices: prices at least THRESHOLD people agree on (shown with "~").
 * - GET /v1/admin/suggestions, POST /v1/admin/resolve: the review queue,
 *   for the local admin view only (bearer ADMIN_TOKEN).
 */
import {
  allowedOrigin,
  consensus,
  DAILY_LIMIT,
  parseSuggestion,
  safeEqual,
  WINDOW_DAYS,
  type PriceGroup,
} from './logic.ts'

type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  TURNSTILE_SECRET: string
  ADMIN_TOKEN: string
  IP_SALT: string
}

const MAX_BODY = 8 * 1024

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
  return json({ prices: consensus(results) }, 200, { 'Cache-Control': 'public, max-age=300' })
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

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/v1/prices' && request.method === 'GET') return prices(env)
  if (pathname === '/v1/suggestions' && request.method === 'POST') return suggest(request, env)
  if (pathname.startsWith('/v1/admin/')) {
    const auth = request.headers.get('Authorization') ?? ''
    if (!env.ADMIN_TOKEN || !safeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`))
      return json({ error: 'unauthorized' }, 401)
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
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
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

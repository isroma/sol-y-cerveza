/**
 * Price suggestions API (Cloudflare Worker + D1).
 *
 * - POST /v1/suggestions: a visitor suggests a price. Turnstile-verified (our
 *   hostname and action), one vote per voter (salted hash of the IPv4 address
 *   or IPv6 /64) per venue, item and brand, daily caps per voter and per
 *   network, an hourly cap per venue, plausible prices only, and only for
 *   venues in the data.
 * - GET /v1/prices: prices at least THRESHOLD networks agree on (shown with "~"),
 *   minus the ones the owner rejected; cached for PRICES_TTL_SECONDS and purged
 *   when the owner changes a price or resolves a suggestion.
 * - GET /v1/admin/suggestions, POST /v1/admin/resolve: the review queue,
 *   for the local admin view only (bearer ADMIN_TOKEN).
 * - Owner mode (bearer OWNER_TOKEN, which can only add or remove prices):
 *   GET /v1/owner/check, PUT/DELETE /v1/owner/prices saves a confirmed price,
 *   POST /v1/owner/photo reads prices and the bar's name from a photo (at most
 *   PHOTO_DAILY_LIMIT a day).
 * - GET /v1/admin/owner-prices: owner prices, for the admin's import.
 * - POST /v1/reports: a visitor reports a venue that moved, closed or is missing,
 *   whether it has a terrace, or where the terrace is (ADR-0009), with the same
 *   identity and caps as suggestions. Never applied automatically.
 * - POST /v1/changes: the card back's price, move and closed for one venue,
 *   behind one bot check (action 'change'), checked and capped as the two
 *   endpoints above would, and stored together or not at all.
 * - GET /v1/admin/reports, POST /v1/admin/reports/resolve: the reports queue.
 *
 * It fails closed when misconfigured: no usable IP_SALT means 503 on the endpoints
 * that hash addresses, and a Turnstile test secret only passes on localhost.
 */
import {
  allowedOrigin,
  consensus,
  EVENT_RETENTION_HOURS,
  isLocalRequest,
  isTestSecret,
  limitHit,
  madridDate,
  parseOwnerPrice,
  parsePriceResolution,
  parseSuggestion,
  safeEqual,
  saltUsable,
  TURNSTILE_ACTION,
  turnstilePassed,
  voterKeys,
  WINDOW_DAYS,
  withOwnerPrices,
  type OwnerRow,
  type PriceGroup,
  type Suggestion,
} from './logic.ts'
import { CHANGE_TURNSTILE_ACTION, parseChange } from './changes.ts'
import {
  parsePhoto,
  PHOTO_DAILY_LIMIT,
  PhotoError,
  readPhoto,
} from './photo.ts'
import {
  distanceMetres,
  maxDistance,
  NEW_VENUE_KEY,
  parseReport,
  parseResolution,
  REPORT_TURNSTILE_ACTION,
  reportQueue,
  type LatLon,
  type Report,
  type ReportRow,
} from './reports.ts'

/** Bindings and vars; a secret that was never set is undefined at runtime. */
type Env = {
  DB: D1Database
  ALLOWED_ORIGINS: string
  TERRACES_URL: string
  TURNSTILE_SECRET?: string
  ADMIN_TOKEN?: string
  IP_SALT?: string
  OWNER_TOKEN?: string
  ANTHROPIC_API_KEY?: string
}

/** The largest JSON body, in bytes, of every endpoint but the photo one. */
const MAX_BODY = 8 * 1024
/** A downscaled photo (about 0.5 MB) as base64, with room to spare, in bytes. */
const MAX_PHOTO_BODY = 7 * 1024 * 1024
/** How long a GET /v1/prices answer may be reused, by browsers and the Cache API. */
const PRICES_TTL_SECONDS = 300
/**
 * How long one isolate reuses its last GET /v1/prices answer. Short, because a
 * purge only reaches the isolate (and the data centre's cache) that took the write.
 */
const PRICES_MEMO_SECONDS = 60

let venues: { ids: Map<string, LatLon>; until: number } | null = null

/** Venue ids in the published data and each venue's position, cached for an hour per isolate. */
async function knownVenues(env: Env): Promise<Map<string, LatLon>> {
  if (venues && venues.until > Date.now()) return venues.ids
  const response = await fetch(env.TERRACES_URL, { cf: { cacheTtl: 3600 } })
  if (!response.ok) throw new Error(`terraces.json: HTTP ${response.status}`)
  const data: unknown = await response.json()
  const records =
    typeof data === 'object' &&
    data !== null &&
    'terraces' in data &&
    Array.isArray(data.terraces)
      ? data.terraces
      : []
  const ids = new Map<string, LatLon>()
  for (const record of records)
    if (
      typeof record === 'object' &&
      record !== null &&
      typeof record.id === 'string'
    ) {
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
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function turnstileOk(
  env: Env,
  request: Request,
  token: string,
  ip: string,
  action: string,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET ?? ''
  const testSecret = isTestSecret(secret)
  if (testSecret && !isLocalRequest(request.url)) {
    console.error(
      'TURNSTILE_SECRET is a test secret on a deployed Worker: failing verification',
    )
    return false
  }
  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)
  form.append('remoteip', ip)
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: form,
    },
  )
  const result: unknown = await response.json()
  return turnstilePassed(result, env.ALLOWED_ORIGINS, testSecret, action)
}

const LIMIT_MESSAGES = {
  voter: 'too many suggestions today',
  network: 'too many suggestions from this network today',
  venue: 'too many suggestions for this venue right now, try later',
} as const

function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * The request's body as text, or null when it is over `maxBytes`: refused on its
 * Content-Length before reading, and the read itself stops at `maxBytes` bytes.
 */
async function boundedText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = request.headers.get('Content-Length')
  if (declared !== null && !(Number(declared) <= maxBytes)) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk =
      value instanceof Uint8Array
        ? value
        : new TextEncoder().encode(String(value))
    total += chunk.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** A JSON body of at most `maxBytes` bytes, or the error response to send. */
async function jsonBody(
  request: Request,
  maxBytes = MAX_BODY,
  tooLarge = 'too large',
): Promise<{ body: unknown } | Response> {
  const text = await boundedText(request, maxBytes)
  if (text === null) return json({ error: tooLarge }, 413)
  try {
    return { body: JSON.parse(text) }
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
}

/** IP_SALT, or the 503 to send when it is unset or too short to hash addresses with. */
function ipSalt(env: Env): string | Response {
  if (saltUsable(env.IP_SALT)) return env.IP_SALT
  console.error('IP_SALT is unset or too short: refusing to hash addresses')
  return json({ error: 'not configured' }, 503)
}

/** The salted voter and network hashes of a request's address. */
async function identity(
  salt: string,
  ip: string,
): Promise<{ voterHash: string; netHash: string }> {
  const keys = voterKeys(ip)
  return {
    voterHash: await sha256(`${salt}:${keys.voter}`),
    netHash: await sha256(`${salt}:net:${keys.network}`),
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
function logEvent(
  env: Env,
  voterHash: string,
  netHash: string,
  venueKey: string,
  now: number,
) {
  const pruneBefore = new Date(
    now - EVENT_RETENTION_HOURS * 3600_000,
  ).toISOString()
  return [
    env.DB.prepare(
      'INSERT INTO suggestion_events (voter_hash, net_hash, venue_id, at) VALUES (?, ?, ?, ?)',
    ).bind(voterHash, netHash, venueKey, new Date(now).toISOString()),
    env.DB.prepare('DELETE FROM suggestion_events WHERE at < ?').bind(
      pruneBefore,
    ),
  ]
}

/** Stores (or replaces) one voter's price for a venue, item and brand. */
function suggestionWrite(
  env: Env,
  suggestion: Suggestion,
  voterHash: string,
  netHash: string,
  now: number,
) {
  const { venueId, item, brand, cents } = suggestion
  return env.DB.prepare(
    `INSERT INTO suggestions (venue_id, item, brand, cents, ip_hash, net_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (ip_hash, venue_id, item, brand)
     DO UPDATE SET cents = excluded.cents, net_hash = excluded.net_hash,
                   created_at = excluded.created_at, status = 'pending'`,
  ).bind(
    venueId,
    item,
    brand ?? '',
    cents,
    voterHash,
    netHash,
    new Date(now).toISOString(),
  )
}

/**
 * Why a report about a published venue is refused (unknown venue, or a
 * position too far from it), or null.
 */
function reportRefused(
  known: Map<string, LatLon>,
  value: Exclude<Report, { kind: 'add' }>,
): Response | null {
  const published = known.get(value.venueId)
  if (!published) return json({ error: 'unknown venue' }, 400)
  // A NaN position (a record without `venue`) is never within range.
  const limit = maxDistance(value)
  if (
    limit !== null &&
    'lat' in value &&
    !(distanceMetres(published, value) <= limit)
  )
    return json({ error: 'invalid position' }, 400)
  return null
}

/** Stores a report; it replaces the voter's pending one of the same kind for the venue. */
function reportWrites(
  env: Env,
  value: Report,
  voterHash: string,
  netHash: string,
  now: number,
) {
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
  return [
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
  ]
}

async function suggest(request: Request, env: Env): Promise<Response> {
  const salt = ipSalt(env)
  if (typeof salt !== 'string') return salt
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseSuggestion(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (!(await turnstileOk(env, request, parsed.token, ip, TURNSTILE_ACTION)))
    return json({ error: 'bot check failed' }, 403)
  if (!(await knownVenues(env)).has(parsed.value.venueId))
    return json({ error: 'unknown venue' }, 400)

  const { voterHash, netHash } = await identity(salt, ip)
  const { venueId } = parsed.value
  const now = Date.now()
  const capped = await overCap(env, voterHash, netHash, venueId, now)
  if (capped) return capped

  await env.DB.batch([
    suggestionWrite(env, parsed.value, voterHash, netHash, now),
    ...logEvent(env, voterHash, netHash, venueId, now),
  ])
  return json({ ok: true }, 201)
}

async function report(request: Request, env: Env): Promise<Response> {
  const salt = ipSalt(env)
  if (typeof salt !== 'string') return salt
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseReport(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (
    !(await turnstileOk(
      env,
      request,
      parsed.token,
      ip,
      REPORT_TURNSTILE_ACTION,
    ))
  )
    return json({ error: 'bot check failed' }, 403)
  const value = parsed.value
  const venueKey = value.kind === 'add' ? NEW_VENUE_KEY : value.venueId
  if (value.kind !== 'add') {
    const refused = reportRefused(await knownVenues(env), value)
    if (refused) return refused
  }

  const { voterHash, netHash } = await identity(salt, ip)
  const now = Date.now()
  const capped = await overCap(env, voterHash, netHash, venueKey, now)
  if (capped) return capped

  await env.DB.batch([
    ...reportWrites(env, value, voterHash, netHash, now),
    ...logEvent(env, voterHash, netHash, venueKey, now),
  ])
  return json({ ok: true }, 201)
}

/**
 * Everything a visitor suggests for one venue from the card's back (a price,
 * a move, closed) behind one bot check, stored together or not at all. Each
 * part counts towards the caps as its own request would.
 */
async function change(request: Request, env: Env): Promise<Response> {
  const salt = ipSalt(env)
  if (typeof salt !== 'string') return salt
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseChange(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  if (
    !(await turnstileOk(
      env,
      request,
      parsed.token,
      ip,
      CHANGE_TURNSTILE_ACTION,
    ))
  )
    return json({ error: 'bot check failed' }, 403)
  const { venueId, price, reports } = parsed.value
  const published = await knownVenues(env)
  if (!published.has(venueId)) return json({ error: 'unknown venue' }, 400)
  for (const value of reports) {
    if (value.kind === 'add') continue
    const refused = reportRefused(published, value)
    if (refused) return refused
  }

  const { voterHash, netHash } = await identity(salt, ip)
  const now = Date.now()
  const capped = await overCap(env, voterHash, netHash, venueId, now)
  if (capped) return capped

  const parts = (price ? 1 : 0) + reports.length
  await env.DB.batch([
    ...(price ? [suggestionWrite(env, price, voterHash, netHash, now)] : []),
    ...reports.flatMap((value) =>
      reportWrites(env, value, voterHash, netHash, now),
    ),
    ...Array.from({ length: parts }, () =>
      logEvent(env, voterHash, netHash, venueId, now),
    ).flat(),
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
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const resolution = parseResolution(read.body)
  if (!resolution) return json({ error: 'invalid resolution' }, 400)
  const result = await env.DB.prepare(
    `UPDATE venue_reports SET status = ?
     WHERE status = 'pending' AND id IN (SELECT value FROM json_each(?))`,
  )
    .bind(resolution.status, JSON.stringify(resolution.ids))
    .run()
  return json({ updated: result.meta.changes }, 200)
}

/** A price the owner rejected matches this suggestion row (aliased `s`). */
const NOT_REJECTED = `NOT EXISTS (
  SELECT 1 FROM rejected_prices r
  WHERE r.venue_id = s.venue_id AND r.item = s.item AND r.brand = s.brand AND r.cents = s.cents)`

/** The one key GET /v1/prices is cached under: a query string can't bypass the cache. */
function pricesCacheKey(request: Request): Request {
  return new Request(new URL('/v1/prices', request.url).toString(), {
    method: 'GET',
  })
}

/** The last answer in this isolate, for hosts where the Cache API stores nothing. */
let pricesMemo: { body: string; until: number } | null = null

function pricesResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${PRICES_TTL_SECONDS}`,
    },
  })
}

/**
 * GET /v1/prices. The body is cached without CORS headers (those are added per
 * request in `fetch`), so one cached answer serves every allowed Origin.
 */
async function prices(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const now = Date.now()
  if (pricesMemo && pricesMemo.until > now)
    return pricesResponse(pricesMemo.body)
  const key = pricesCacheKey(request)
  const cached = await caches.default.match(key)
  if (cached) return pricesResponse(await cached.text())

  const since = new Date(now - WINDOW_DAYS * 86400_000).toISOString()
  const { results } = await env.DB.prepare(
    `SELECT venue_id, item, brand, cents, COUNT(DISTINCT net_hash) AS voters,
            MAX(created_at) AS last
     FROM suggestions s
     WHERE status != 'rejected' AND created_at >= ? AND ${NOT_REJECTED}
     GROUP BY venue_id, item, brand, cents`,
  )
    .bind(since)
    .all<PriceGroup>()
  const owner = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices',
  ).all<OwnerRow>()
  const body = JSON.stringify({
    prices: withOwnerPrices(consensus(results), owner.results),
  })
  pricesMemo = { body, until: now + PRICES_MEMO_SECONDS * 1000 }
  ctx.waitUntil(caches.default.put(key, pricesResponse(body)))
  return pricesResponse(body)
}

/** Drops the cached GET /v1/prices after a write that changes what it serves. */
async function purgePrices(request: Request): Promise<void> {
  pricesMemo = null
  await caches.default.delete(pricesCacheKey(request))
}

async function pending(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT venue_id, item, brand, cents, COUNT(DISTINCT net_hash) AS voters,
            MAX(created_at) AS last
     FROM suggestions s WHERE status = 'pending' AND ${NOT_REJECTED}
     GROUP BY venue_id, item, brand, cents
     ORDER BY voters DESC, last DESC`,
  ).all<PriceGroup>()
  return json({ suggestions: results }, 200)
}

/**
 * Accepts or rejects a suggested price. A rejection is remembered in
 * `rejected_prices`, so re-votes and new networks can't bring the price back;
 * accepting the same price later lifts it (and its rejected votes count again).
 */
async function resolve(request: Request, env: Env): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const resolution = parsePriceResolution(read.body)
  if (!resolution) return json({ error: 'invalid resolution' }, 400)
  const { venueId, item, brand, cents, status } = resolution
  const match = 'venue_id = ? AND item = ? AND brand = ? AND cents = ?'
  const remember =
    status === 'rejected'
      ? env.DB.prepare(
          `INSERT INTO rejected_prices (venue_id, item, brand, cents, rejected_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (venue_id, item, brand, cents) DO UPDATE SET rejected_at = excluded.rejected_at`,
        ).bind(venueId, item, brand, cents, new Date().toISOString())
      : env.DB.prepare(`DELETE FROM rejected_prices WHERE ${match}`).bind(
          venueId,
          item,
          brand,
          cents,
        )
  const [update] = await env.DB.batch([
    env.DB.prepare(
      status === 'rejected'
        ? `UPDATE suggestions SET status = 'rejected' WHERE status = 'pending' AND ${match}`
        : `UPDATE suggestions SET status = 'accepted' WHERE status != 'accepted' AND ${match}`,
    ).bind(venueId, item, brand, cents),
    remember,
  ])
  await purgePrices(request)
  return json({ updated: update?.meta.changes ?? 0 }, 200)
}

async function ownerPrice(request: Request, env: Env): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseOwnerPrice(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const { venueId, item, brand, cents } = parsed.value
  if (!(await knownVenues(env)).has(venueId))
    return json({ error: 'unknown venue' }, 400)
  if (request.method === 'DELETE') {
    await env.DB.prepare(
      'DELETE FROM owner_prices WHERE venue_id = ? AND item = ? AND brand = ?',
    )
      .bind(venueId, item, brand ?? '')
      .run()
    await purgePrices(request)
    return json({ ok: true }, 200)
  }
  const seen = madridDate(new Date())
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO owner_prices (venue_id, item, brand, cents, seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (venue_id, item, brand) DO UPDATE SET cents = excluded.cents, seen = excluded.seen`,
    ).bind(venueId, item, brand ?? '', cents, seen),
    // The owner saw this price on site: a rejection of it no longer stands.
    env.DB.prepare(
      'DELETE FROM rejected_prices WHERE venue_id = ? AND item = ? AND brand = ? AND cents = ?',
    ).bind(venueId, item, brand ?? '', cents),
  ])
  await purgePrices(request)
  return json({ ok: true, seen }, 200)
}

/**
 * Takes one of the day's PHOTO_DAILY_LIMIT photo readings, or returns the 429 to
 * send. The check and the insert are one statement, so parallel requests can't
 * both take the last one.
 */
async function photoAllowance(env: Env, now: number): Promise<Response | null> {
  const dayAgo = new Date(now - 86400_000).toISOString()
  const pruneBefore = new Date(
    now - EVENT_RETENTION_HOURS * 3600_000,
  ).toISOString()
  const [taken] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO owner_photo_events (at)
       SELECT ?1 WHERE (SELECT COUNT(*) FROM owner_photo_events WHERE at >= ?2) < ?3`,
    ).bind(new Date(now).toISOString(), dayAgo, PHOTO_DAILY_LIMIT),
    env.DB.prepare('DELETE FROM owner_photo_events WHERE at < ?').bind(
      pruneBefore,
    ),
  ])
  if (taken?.meta.changes) return null
  const oldest = await env.DB.prepare(
    'SELECT MIN(at) AS at FROM owner_photo_events WHERE at >= ?',
  )
    .bind(dayAgo)
    .first<{ at: string | null }>()
  const freeAt = oldest?.at ? Date.parse(oldest.at) + 86400_000 : now + 3600_000
  return json({ error: `at most ${PHOTO_DAILY_LIMIT} photos a day` }, 429, {
    'Retry-After': String(Math.max(1, Math.ceil((freeAt - now) / 1000))),
  })
}

async function ownerPhoto(request: Request, env: Env): Promise<Response> {
  const read = await jsonBody(request, MAX_PHOTO_BODY, 'the photo is too large')
  if (read instanceof Response) return read
  try {
    const photo = parsePhoto(read.body)
    const capped = await photoAllowance(env, Date.now())
    if (capped) return capped
    return json(await readPhoto(env.ANTHROPIC_API_KEY ?? '', photo), 200)
  } catch (error) {
    if (error instanceof PhotoError)
      return json({ error: error.message }, error.status)
    throw error
  }
}

async function ownerPrices(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices ORDER BY venue_id, item, brand',
  ).all<OwnerRow>()
  return json({ prices: results }, 200)
}

function bearer(request: Request, token: string | undefined): boolean {
  return (
    Boolean(token) &&
    safeEqual(request.headers.get('Authorization') ?? '', `Bearer ${token}`)
  )
}

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/v1/prices' && request.method === 'GET')
    return prices(request, env, ctx)
  if (pathname === '/v1/suggestions' && request.method === 'POST')
    return suggest(request, env)
  if (pathname === '/v1/changes' && request.method === 'POST')
    return change(request, env)
  if (pathname === '/v1/reports' && request.method === 'POST')
    return report(request, env)
  if (pathname.startsWith('/v1/owner/')) {
    if (!bearer(request, env.OWNER_TOKEN))
      return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/owner/check' && request.method === 'GET')
      return json({ ok: true }, 200)
    if (
      pathname === '/v1/owner/prices' &&
      (request.method === 'PUT' || request.method === 'DELETE')
    )
      return ownerPrice(request, env)
    if (pathname === '/v1/owner/photo' && request.method === 'POST')
      return ownerPhoto(request, env)
  }
  if (pathname.startsWith('/v1/admin/')) {
    if (!bearer(request, env.ADMIN_TOKEN))
      return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/admin/owner-prices' && request.method === 'GET')
      return ownerPrices(env)
    if (pathname === '/v1/admin/suggestions' && request.method === 'GET')
      return pending(env)
    if (pathname === '/v1/admin/resolve' && request.method === 'POST')
      return resolve(request, env)
    if (pathname === '/v1/admin/reports' && request.method === 'GET')
      return pendingReports(env)
    if (pathname === '/v1/admin/reports/resolve' && request.method === 'POST')
      return resolveReports(request, env)
  }
  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const origin = allowedOrigin(
      request.headers.get('Origin'),
      env.ALLOWED_ORIGINS,
    )
    const cors: Record<string, string> = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          Vary: 'Origin',
        }
      : {}
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors })
    let response: Response
    try {
      response = await route(request, env, ctx)
    } catch (error) {
      console.error(error)
      response = json({ error: 'server error' }, 500)
    }
    for (const [name, value] of Object.entries(cors))
      response.headers.set(name, value)
    return response
  },
} satisfies ExportedHandler<Env>

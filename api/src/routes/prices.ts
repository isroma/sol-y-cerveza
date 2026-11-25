import type { Env } from '../env.ts'
import {
  identity,
  ipSalt,
  knownVenues,
  takeAllowance,
  turnstileOk,
} from '../guard.ts'
import { json, jsonBody } from '../http.ts'
import {
  consensus,
  parsePriceResolution,
  parseSuggestion,
  TURNSTILE_ACTION,
  WINDOW_DAYS,
  withOwnerPrices,
  type OwnerRow,
  type PriceGroup,
  type Suggestion,
} from '../logic.ts'

/** How long a GET /v1/prices answer may be reused, by browsers and the Cache API. */
const PRICES_TTL_SECONDS = 300
/**
 * How long one isolate reuses its last GET /v1/prices answer. Short, because a
 * purge only reaches the isolate (and the data centre's cache) that took the write.
 */
const PRICES_MEMO_SECONDS = 60

/** Stores (or replaces) one voter's price for a venue, item and brand. */
export function suggestionWrite(
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

export async function suggest(request: Request, env: Env): Promise<Response> {
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
  const capped = await takeAllowance(env, voterHash, netHash, venueId, 1, now)
  if (capped) return capped

  await suggestionWrite(env, parsed.value, voterHash, netHash, now).run()
  return json({ ok: true }, 201)
}

/** A price the owner rejected matches this suggestion row (aliased `s`). */
export const NOT_REJECTED = `NOT EXISTS (
  SELECT 1 FROM rejected_prices r
  WHERE r.venue_id = s.venue_id AND r.item = s.item AND r.brand = s.brand AND r.cents = s.cents)`

/** The one key GET /v1/prices is cached under: a query string can't bypass the cache. */
export function pricesCacheKey(request: Request): Request {
  return new Request(new URL('/v1/prices', request.url).toString(), {
    method: 'GET',
  })
}

/** The last answer in this isolate, for hosts where the Cache API stores nothing. */
let pricesMemo: { body: string; until: number } | null = null

export function pricesResponse(body: string): Response {
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
export async function prices(
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
  // One round trip to D1 for both reads.
  const [suggested, owner] = await env.DB.batch<PriceGroup | OwnerRow>([
    env.DB.prepare(
      `SELECT venue_id, item, brand, cents, COUNT(DISTINCT net_hash) AS voters,
              MAX(created_at) AS last
       FROM suggestions s
       WHERE status != 'rejected' AND created_at >= ? AND ${NOT_REJECTED}
       GROUP BY venue_id, item, brand, cents`,
    ).bind(since),
    env.DB.prepare(
      'SELECT venue_id, item, brand, cents, seen FROM owner_prices',
    ),
  ])
  const body = JSON.stringify({
    prices: withOwnerPrices(
      consensus((suggested?.results ?? []) as PriceGroup[]),
      (owner?.results ?? []) as OwnerRow[],
    ),
  })
  pricesMemo = { body, until: now + PRICES_MEMO_SECONDS * 1000 }
  ctx.waitUntil(caches.default.put(key, pricesResponse(body)))
  return pricesResponse(body)
}

/** Drops the cached GET /v1/prices after a write that changes what it serves. */
export async function purgePrices(request: Request): Promise<void> {
  pricesMemo = null
  await caches.default.delete(pricesCacheKey(request))
}

export async function pending(env: Env): Promise<Response> {
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
export async function resolve(request: Request, env: Env): Promise<Response> {
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

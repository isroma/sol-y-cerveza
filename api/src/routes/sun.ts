import type { Env } from '../env.ts'
import { json, jsonBody } from '../http.ts'
import { parseResolution } from '../reports.ts'
import {
  SUN_SPREAD_DEGREES,
  SUN_WINDOW_DAYS,
  acceptedSun,
  sunCorrections,
  sunQueue,
  type RejectionRow,
  type Sighting,
  type SunRow,
} from '../sun.ts'

/** How long a GET /v1/sun answer may be reused, by browsers and the Cache API (as prices). */
const SUN_TTL_SECONDS = 300
/** How long one isolate reuses its last GET /v1/sun answer (as prices). */
const SUN_MEMO_SECONDS = 60

/**
 * Stores a sun report. A visitor's replaces their pending one for the venue
 * and season within SUN_SPREAD_DEGREES; the owner's is stored accepted.
 */
export function sunWrites(
  env: Env,
  venueId: string,
  value: Sighting,
  voterHash: string,
  netHash: string,
  now: number,
  byOwner = false,
) {
  const leafOff = Number(value.leafOff)
  const replaced = byOwner
    ? []
    : [
        env.DB.prepare(
          `DELETE FROM sun_reports
           WHERE status = 'pending' AND voter_hash = ?1 AND venue_id = ?2 AND leaf_off = ?3
             AND min((bin - ?4 + 360) % 360, (?4 - bin + 360) % 360) <= ?5`,
        ).bind(voterHash, venueId, leafOff, value.bin, SUN_SPREAD_DEGREES),
      ]
  return [
    ...replaced,
    env.DB.prepare(
      `INSERT INTO sun_reports
         (venue_id, azimuth, altitude, bin, leaf_off, voter_hash, net_hash, created_at, status, by_owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      venueId,
      value.azimuth,
      value.altitude,
      value.bin,
      leafOff,
      voterHash,
      netHash,
      new Date(now).toISOString(),
      byOwner ? 'accepted' : 'pending',
      Number(byOwner),
    ),
  ]
}

/** Every report not rejected, and the rejections still standing, in one round trip. */
async function readSun(
  env: Env,
  now: number,
  pendingAtAnyAge: boolean,
): Promise<{ rows: SunRow[]; rejections: RejectionRow[] }> {
  const since = new Date(now - SUN_WINDOW_DAYS * 86400_000).toISOString()
  const [rows, rejections] = await env.DB.batch<SunRow | RejectionRow>([
    env.DB.prepare(
      `SELECT id, venue_id, azimuth, altitude, leaf_off, net_hash, created_at, status
       FROM sun_reports
       WHERE status != 'rejected' AND (created_at >= ? OR (? AND status = 'pending'))`,
    ).bind(since, Number(pendingAtAnyAge)),
    env.DB.prepare(
      'SELECT venue_id, leaf_off, bin, rejected_at FROM sun_rejections WHERE rejected_at >= ?',
    ).bind(since),
  ])
  return {
    rows: (rows?.results ?? []) as SunRow[],
    rejections: (rejections?.results ?? []) as RejectionRow[],
  }
}

/** The one key GET /v1/sun is cached under: a query string can't bypass the cache. */
function sunCacheKey(request: Request): Request {
  return new Request(new URL('/v1/sun', request.url).toString(), {
    method: 'GET',
  })
}

/** The last answer in this isolate, for hosts where the Cache API stores nothing. */
let sunMemo: { body: string; until: number } | null = null

function sunResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${SUN_TTL_SECONDS}`,
    },
  })
}

/** GET /v1/sun, cached like GET /v1/prices (without CORS headers). */
export async function sun(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const now = Date.now()
  if (sunMemo && sunMemo.until > now) return sunResponse(sunMemo.body)
  const key = sunCacheKey(request)
  const cached = await caches.default.match(key)
  if (cached) return sunResponse(await cached.text())

  const { rows, rejections } = await readSun(env, now, false)
  const body = JSON.stringify({
    corrections: sunCorrections(rows, rejections, now),
  })
  sunMemo = { body, until: now + SUN_MEMO_SECONDS * 1000 }
  ctx.waitUntil(caches.default.put(key, sunResponse(body)))
  return sunResponse(body)
}

/** Drops the cached GET /v1/sun after a write that changes what it serves. */
export async function purgeSun(request: Request): Promise<void> {
  sunMemo = null
  await caches.default.delete(sunCacheKey(request))
}

/**
 * GET /v1/admin/sun/accepted: the accepted reports in the window, which the
 * admin copies into pipeline/data/sun_corrections.csv for Publish.
 */
export async function acceptedSunReports(env: Env): Promise<Response> {
  const now = Date.now()
  const since = new Date(now - SUN_WINDOW_DAYS * 86400_000).toISOString()
  const { results } = await env.DB.prepare(
    `SELECT id, venue_id, azimuth, altitude, leaf_off, net_hash, created_at, status
     FROM sun_reports WHERE status = 'accepted' AND created_at >= ? ORDER BY id`,
  )
    .bind(since)
    .all<SunRow>()
  return json({ reports: acceptedSun(results, now) }, 200)
}

/** GET /v1/admin/sun: the pending reports, per venue and season. */
export async function pendingSun(env: Env): Promise<Response> {
  const now = Date.now()
  const { rows, rejections } = await readSun(env, now, true)
  return json({ reports: sunQueue(rows, rejections, now) }, 200)
}

/**
 * POST /v1/admin/sun/resolve: accepts or rejects pending sun reports. A
 * rejection also records each report's slice of sky in `sun_rejections`, so
 * no consensus lowers the horizon there for SUN_WINDOW_DAYS.
 */
export async function resolveSun(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const resolution = parseResolution(read.body)
  if (!resolution) return json({ error: 'invalid resolution' }, 400)
  const ids = JSON.stringify(resolution.ids)
  const pending =
    "status = 'pending' AND id IN (SELECT value FROM json_each(?))"
  // The slices are read before the reports stop being pending: same batch, in order.
  const remember =
    resolution.status === 'rejected'
      ? [
          env.DB.prepare(
            `INSERT INTO sun_rejections (venue_id, leaf_off, bin, rejected_at)
             SELECT DISTINCT venue_id, leaf_off, bin, ? FROM sun_reports WHERE ${pending}
             ON CONFLICT (venue_id, leaf_off, bin) DO UPDATE SET rejected_at = excluded.rejected_at`,
          ).bind(new Date().toISOString(), ids),
        ]
      : []
  await env.DB.batch([
    ...remember,
    env.DB.prepare(`UPDATE sun_reports SET status = ? WHERE ${pending}`).bind(
      resolution.status,
      ids,
    ),
  ])
  await purgeSun(request)
  return json({ ok: true }, 200)
}

import type { Env } from '../env.ts'
import { json, jsonBody } from '../http.ts'
import { parseResolution } from '../reports.ts'
import type { LatLon } from '../../../web/src/data/geo.ts'
import {
  SHADE_SPREAD_DEGREES,
  SUN_SPREAD_DEGREES,
  SUN_WINDOW_DAYS,
  acceptedSun,
  sighting,
  sunCorrections,
  sunQueue,
  type RejectionRow,
  type Sighting,
  type SkyKind,
  type SunRow,
} from '../sun.ts'
import { directSunNow, SHADE_MIN_DNI } from '../weather.ts'

/** How long a GET /v1/sun answer may be reused, by browsers and the Cache API (as prices). */
const SUN_TTL_SECONDS = 300
/** How long one isolate reuses its last GET /v1/sun answer (as prices). */
const SUN_MEMO_SECONDS = 60

/**
 * Where the sun is for a sun or shade report on a venue at `position`, or the
 * response that refuses it: the sun is down, the venue has no position, or (for
 * shade, ADR-0014) the sun isn't clearly out over Badajoz right now.
 */
export async function skySighting(
  kind: SkyKind,
  position: LatLon | undefined,
  now: number,
): Promise<Sighting | Response> {
  const seen = sighting(position, new Date(now))
  if (!seen.ok) return json({ error: seen.error }, 400)
  if (kind === 'shade') {
    const dni = await directSunNow(now)
    if (dni === null) return json({ error: 'weather unavailable' }, 503)
    if (dni < SHADE_MIN_DNI) return json({ error: 'not sunny' }, 400)
  }
  return seen.value
}

/**
 * Stores a sun or shade report. A visitor's replaces their pending one of the
 * same kind for the venue and season within that kind's spread; the owner's
 * is stored accepted.
 */
export function sunWrites(
  env: Env,
  venueId: string,
  value: Sighting,
  voterHash: string,
  netHash: string,
  now: number,
  byOwner = false,
  kind: SkyKind = 'sun',
) {
  const leafOff = Number(value.leafOff)
  const spread = kind === 'shade' ? SHADE_SPREAD_DEGREES : SUN_SPREAD_DEGREES
  const replaced = byOwner
    ? []
    : [
        env.DB.prepare(
          `DELETE FROM sun_reports
           WHERE status = 'pending' AND voter_hash = ?1 AND venue_id = ?2 AND leaf_off = ?3
             AND kind = ?6
             AND min((bin - ?4 + 360) % 360, (?4 - bin + 360) % 360) <= ?5`,
        ).bind(voterHash, venueId, leafOff, value.bin, spread, kind),
      ]
  return [
    ...replaced,
    env.DB.prepare(
      `INSERT INTO sun_reports
         (venue_id, azimuth, altitude, bin, leaf_off, voter_hash, net_hash, created_at, status, by_owner, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      kind,
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
      `SELECT id, venue_id, azimuth, altitude, leaf_off, net_hash, created_at, status, kind
       FROM sun_reports
       WHERE status != 'rejected' AND (created_at >= ? OR (? AND status = 'pending'))`,
    ).bind(since, Number(pendingAtAnyAge)),
    env.DB.prepare(
      `SELECT venue_id, leaf_off, bin, rejected_at, 'sun' AS kind FROM sun_rejections WHERE rejected_at >= ?1
       UNION ALL
       SELECT venue_id, leaf_off, bin, rejected_at, 'shade' AS kind FROM shade_rejections WHERE rejected_at >= ?1`,
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
    shade: sunCorrections(rows, rejections, now, 'shade'),
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
    `SELECT id, venue_id, azimuth, altitude, leaf_off, net_hash, created_at, status, kind
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
 * POST /v1/admin/sun/resolve: accepts or rejects pending sun and shade reports.
 * A rejection also records each report's slice of sky in `sun_rejections` (or
 * `shade_rejections`), so no consensus of that kind changes the horizon there
 * for SUN_WINDOW_DAYS.
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
  const at = new Date().toISOString()
  const remember =
    resolution.status === 'rejected'
      ? (['sun', 'shade'] as const).map((kind) =>
          env.DB.prepare(
            `INSERT INTO ${kind}_rejections (venue_id, leaf_off, bin, rejected_at)
             SELECT DISTINCT venue_id, leaf_off, bin, ? FROM sun_reports WHERE ${pending} AND kind = ?
             ON CONFLICT (venue_id, leaf_off, bin) DO UPDATE SET rejected_at = excluded.rejected_at`,
          ).bind(at, ids, kind),
        )
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

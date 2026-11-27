import { CHANGE_TURNSTILE_ACTION, parseChange } from '../changes.ts'
import type { Env } from '../env.ts'
import {
  identity,
  ipSalt,
  knownVenues,
  takeAllowance,
  turnstileOk,
} from '../guard.ts'
import { json, jsonBody } from '../http.ts'
import { distanceMetres, type LatLon } from '../../../web/src/data/geo.ts'
import {
  DELETE_OPEN_REPORT,
  maxDistance,
  newVenueKey,
  parseReport,
  parseResolution,
  REPORT_TURNSTILE_ACTION,
  reportQueue,
  type Report,
  type ReportRow,
} from '../reports.ts'
import { suggestionWrite } from './prices.ts'
import { skySighting, sunWrites } from './sun.ts'

/**
 * Why a report about a published venue is refused (unknown venue, or a
 * position too far from it), or null.
 */
export function reportRefused(
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
export function reportWrites(
  env: Env,
  value: Report,
  voterHash: string,
  netHash: string,
  now: number,
  byOwner = false,
) {
  const venueId = value.kind === 'add' ? '' : value.venueId
  const replaced =
    value.kind === 'add'
      ? []
      : [
          env.DB.prepare(DELETE_OPEN_REPORT).bind(
            value.kind,
            venueId,
            voterHash,
          ),
        ]
  return [
    ...replaced,
    env.DB.prepare(
      `INSERT INTO venue_reports
         (kind, venue_id, name, venue_kind, lat, lon, terrace, voter_hash, net_hash, created_at, by_owner)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      Number(byOwner),
    ),
  ]
}

export async function report(request: Request, env: Env): Promise<Response> {
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
  const venueKey = value.kind === 'add' ? newVenueKey(value) : value.venueId
  if (value.kind !== 'add') {
    const refused = reportRefused(await knownVenues(env), value)
    if (refused) return refused
  }

  const { voterHash, netHash } = await identity(salt, ip)
  const now = Date.now()
  const capped = await takeAllowance(env, voterHash, netHash, venueKey, 1, now)
  if (capped) return capped

  await env.DB.batch(reportWrites(env, value, voterHash, netHash, now))
  return json({ ok: true }, 201)
}

/**
 * Everything a visitor suggests for one venue from the card's back (a price,
 * a move, closed, a terrace answer, a tables pin, sun now) behind one bot
 * check, stored together or not at all. Each part counts towards the caps as
 * its own request would, and each report replaces the voter's open one of its
 * kind, as on POST /v1/reports.
 */
export async function change(request: Request, env: Env): Promise<Response> {
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
  const now = Date.now()
  const { sky } = parsed.value
  const sun = sky ? await skySighting(sky, published.get(venueId), now) : null
  if (sun instanceof Response) return sun

  const { voterHash, netHash } = await identity(salt, ip)
  const parts = (price ? 1 : 0) + reports.length + (sun ? 1 : 0)
  const capped = await takeAllowance(
    env,
    voterHash,
    netHash,
    venueId,
    parts,
    now,
  )
  if (capped) return capped

  await env.DB.batch([
    ...(price ? [suggestionWrite(env, price, voterHash, netHash, now)] : []),
    ...reports.flatMap((value) =>
      reportWrites(env, value, voterHash, netHash, now),
    ),
    ...(sun && sky
      ? sunWrites(env, venueId, sun, voterHash, netHash, now, false, sky)
      : []),
  ])
  return json({ ok: true }, 201)
}

export async function pendingReports(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, kind, venue_id, name, venue_kind, lat, lon, terrace, net_hash, created_at, by_owner
     FROM venue_reports WHERE status = 'pending'`,
  ).all<ReportRow>()
  return json({ reports: reportQueue(results) }, 200)
}

export async function resolveReports(
  request: Request,
  env: Env,
): Promise<Response> {
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

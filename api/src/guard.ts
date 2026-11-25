import type { Env } from './env.ts'
import { json } from './http.ts'
import {
  DAILY_LIMIT,
  EVENT_RETENTION_HOURS,
  isLocalRequest,
  isTestSecret,
  limitHit,
  NETWORK_DAILY_LIMIT,
  saltUsable,
  turnstilePassed,
  VENUE_HOURLY_LIMIT,
  voterKeys,
} from './logic.ts'
import type { LatLon } from '../../web/src/data/geo.ts'

let venues: { ids: Map<string, LatLon>; until: number } | null = null

/** Venue ids in the published data and each venue's position, cached for an hour per isolate. */
export async function knownVenues(env: Env): Promise<Map<string, LatLon>> {
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

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function turnstileOk(
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

export const LIMIT_MESSAGES = {
  voter: 'too many suggestions today',
  network: 'too many suggestions from this network today',
  venue: 'too many suggestions for this venue right now, try later',
} as const

/** IP_SALT, or the 503 to send when it is unset or too short to hash addresses with. */
export function ipSalt(env: Env): string | Response {
  if (saltUsable(env.IP_SALT)) return env.IP_SALT
  console.error('IP_SALT is unset or too short: refusing to hash addresses')
  return json({ error: 'not configured' }, 503)
}

/** The salted voter and network hashes of a request's address. */
export async function identity(
  salt: string,
  ip: string,
): Promise<{ voterHash: string; netHash: string }> {
  const keys = voterKeys(ip)
  return {
    voterHash: await sha256(`${salt}:${keys.voter}`),
    netHash: await sha256(`${salt}:net:${keys.network}`),
  }
}

/**
 * Takes `parts` events (one per suggestion or report) from the voter's,
 * network's and venue key's allowance, or returns the 429 to send when that
 * would break a cap. The check and the inserts are one statement, as in
 * photoAllowance, so parallel requests can't all read the counts before any of
 * them is logged. It runs after a request is validated and before its writes,
 * so a refused or invalid request takes nothing.
 */
export async function takeAllowance(
  env: Env,
  voterHash: string,
  netHash: string,
  venueKey: string,
  parts: number,
  now: number,
): Promise<Response | null> {
  const dayAgo = new Date(now - 86400_000).toISOString()
  const hourAgo = new Date(now - 3600_000).toISOString()
  const pruneBefore = new Date(
    now - EVENT_RETENTION_HOURS * 3600_000,
  ).toISOString()
  const [taken] = await env.DB.batch([
    env.DB.prepare(
      `WITH RECURSIVE part(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM part WHERE n < ?5)
       INSERT INTO suggestion_events (voter_hash, net_hash, venue_id, at)
       SELECT ?1, ?2, ?3, ?4 FROM part
       WHERE (SELECT COUNT(*) FROM suggestion_events WHERE voter_hash = ?1 AND at >= ?6) + ?5 <= ?8
         AND (SELECT COUNT(*) FROM suggestion_events WHERE net_hash = ?2 AND at >= ?6) + ?5 <= ?9
         AND (SELECT COUNT(*) FROM suggestion_events WHERE venue_id = ?3 AND at >= ?7) + ?5 <= ?10`,
    ).bind(
      voterHash,
      netHash,
      venueKey,
      new Date(now).toISOString(),
      parts,
      dayAgo,
      hourAgo,
      DAILY_LIMIT,
      NETWORK_DAILY_LIMIT,
      VENUE_HOURLY_LIMIT,
    ),
    env.DB.prepare('DELETE FROM suggestion_events WHERE at < ?').bind(
      pruneBefore,
    ),
  ])
  if (taken?.meta.changes) return null
  const counts = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM suggestion_events WHERE voter_hash = ?1 AND at >= ?4) AS voter,
       (SELECT COUNT(*) FROM suggestion_events WHERE net_hash = ?2 AND at >= ?4) AS network,
       (SELECT COUNT(*) FROM suggestion_events WHERE venue_id = ?3 AND at >= ?5) AS venue`,
  )
    .bind(voterHash, netHash, venueKey, dayAgo, hourAgo)
    .first<{ voter: number; network: number; venue: number }>()
  const hit =
    limitHit(counts ?? { voter: 0, network: 0, venue: 0 }, parts) ?? 'voter'
  return json({ error: LIMIT_MESSAGES[hit] }, 429, {
    'Retry-After': hit === 'venue' ? '3600' : '86400',
  })
}

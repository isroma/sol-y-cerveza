/**
 * Anonymous usage counters (ADR-0013): POST /v1/events adds to daily
 * aggregate counters, GET /v1/admin/stats reads them. Nothing about the
 * visitor is read or stored: no Turnstile, no voter or network hash (so no
 * IP_SALT), no IP, user agent or referrer. Only `knownVenues` comes from
 * guard.ts, to count a venue only when it is in the published data.
 */
import type { Env } from '../env.ts'
import {
  countEvents,
  EVENTS_MAX_BODY,
  needsVenue,
  parseEvents,
  statsDays,
  statsSince,
} from '../events.ts'
import { knownVenues } from '../guard.ts'
import { json, jsonBody } from '../http.ts'
import { madridDate } from '../logic.ts'

/**
 * POST /v1/events: `{events: [{name, value?}]}`, at most MAX_EVENTS. A body
 * that isn't that is 400 (413 over EVENTS_MAX_BODY); events off the allowlist
 * are dropped without a word. 204 either way once the body is well formed.
 */
export async function postEvents(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await jsonBody(request, EVENTS_MAX_BODY)
  if (read instanceof Response) return read
  const events = parseEvents(read.body)
  if (!events) return json({ error: 'invalid events' }, 400)
  // terraces.json only when a venue needs checking; if it can't be read,
  // the venue events are dropped and the rest still count.
  let venues: ReadonlyMap<string, unknown> = new Map()
  if (events.some(needsVenue))
    venues = await knownVenues(env).catch(() => new Map())
  const counts = countEvents(events, (id) => venues.has(id))
  if (counts.length > 0) {
    const day = madridDate(new Date())
    await env.DB.batch(
      counts.map(({ name, value, count }) =>
        env.DB.prepare(
          `INSERT INTO event_counts (day, name, value, count) VALUES (?, ?, ?, ?)
           ON CONFLICT (day, name, value) DO UPDATE SET count = count + excluded.count`,
        ).bind(day, name, value, count),
      ),
    )
  }
  return new Response(null, {
    status: 204,
    headers: { 'Cache-Control': 'no-store' },
  })
}

type StatsRow = { day: string; name: string; value: string; count: number }

/** GET /v1/admin/stats?days=N: the counters of the last N Madrid days (default 30, at most 365). */
export async function stats(request: Request, env: Env): Promise<Response> {
  const days = statsDays(new URL(request.url).searchParams.get('days'))
  const { results } = await env.DB.prepare(
    `SELECT day, name, value, count FROM event_counts
     WHERE day >= ? ORDER BY day DESC, name, value`,
  )
    .bind(statsSince(new Date(), days))
    .all<StatsRow>()
  return json({ rows: results }, 200, { 'Cache-Control': 'no-store' })
}

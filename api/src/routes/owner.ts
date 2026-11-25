import type { Env } from '../env.ts'
import { knownVenues } from '../guard.ts'
import { json, jsonBody, MAX_PHOTO_BODY } from '../http.ts'
import {
  EVENT_RETENTION_HOURS,
  madridDate,
  parseOwnerPrice,
  type OwnerRow,
} from '../logic.ts'
import {
  parsePhoto,
  PHOTO_DAILY_LIMIT,
  PhotoError,
  readPhoto,
} from '../photo.ts'
import { purgePrices } from './prices.ts'

export async function ownerPrice(
  request: Request,
  env: Env,
): Promise<Response> {
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
export async function photoAllowance(
  env: Env,
  now: number,
): Promise<Response | null> {
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

export async function ownerPhoto(
  request: Request,
  env: Env,
): Promise<Response> {
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

export async function ownerPrices(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices ORDER BY venue_id, item, brand',
  ).all<OwnerRow>()
  return json({ prices: results }, 200)
}

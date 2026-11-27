import type { Env } from '../env.ts'
import { knownVenues } from '../guard.ts'
import { parseChange } from '../changes.ts'
import { json, jsonBody } from '../http.ts'
import {
  madridDate,
  parseOwnerPrice,
  type OwnerRow,
  type Suggestion,
} from '../logic.ts'
import { parseReport } from '../reports.ts'
import { purgePrices } from './prices.ts'
import { reportRefused, reportWrites } from './reports.ts'
import { purgeSun, skySighting, sunWrites } from './sun.ts'

/** Stands in for the voter and network hashes on the owner's reports. */
const OWNER_HASH = 'owner'

export async function ownerPrice(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseOwnerPrice(read.body)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const { venueId, item, brand } = parsed.value
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
  await env.DB.batch(ownerPriceWrites(env, parsed.value, seen))
  await purgePrices(request)
  return json({ ok: true, seen }, 200)
}

/** Saves a confirmed price, dated `seen` (the Madrid date). */
function ownerPriceWrites(
  env: Env,
  { venueId, item, brand, cents }: Suggestion,
  seen: string,
) {
  return [
    env.DB.prepare(
      `INSERT INTO owner_prices (venue_id, item, brand, cents, seen) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (venue_id, item, brand) DO UPDATE SET cents = excluded.cents, seen = excluded.seen`,
    ).bind(venueId, item, brand ?? '', cents, seen),
    // The owner saw this price on site: a rejection of it no longer stands.
    env.DB.prepare(
      'DELETE FROM rejected_prices WHERE venue_id = ? AND item = ? AND brand = ? AND cents = ?',
    ).bind(venueId, item, brand ?? '', cents),
  ]
}

/**
 * The card back in owner mode: what a visitor would suggest, as the owner's
 * change. A price is saved as confirmed and shows at once; a move, closed, a
 * terrace answer or a tables pin is stored as the owner's report, which the
 * admin applies as it opens and ships with Publish;
 * sun now is stored accepted and served at once as confirmed.
 * No bot check and no caps, stored together or not at all.
 */
export async function ownerChange(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const parsed = parseChange(read.body, true)
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
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
  await env.DB.batch([
    ...(price ? ownerPriceWrites(env, price, madridDate(new Date(now))) : []),
    ...reports.flatMap((value) =>
      reportWrites(env, value, OWNER_HASH, OWNER_HASH, now, true),
    ),
    ...(sun
      ? sunWrites(
          env,
          venueId,
          sun,
          OWNER_HASH,
          OWNER_HASH,
          now,
          true,
          sky ?? 'sun',
        )
      : []),
  ])
  if (price) await purgePrices(request)
  if (sun) await purgeSun(request)
  return json({ ok: true }, 201)
}

/** "¿Falta un bar?" in owner mode: a new venue the admin adds at its next Publish. */
export async function ownerReport(
  request: Request,
  env: Env,
): Promise<Response> {
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  if (typeof read.body !== 'object' || read.body === null)
    return json({ error: 'invalid body' }, 400)
  const parsed = parseReport({ ...read.body, token: OWNER_HASH })
  if (!parsed.ok) return json({ error: `invalid ${parsed.error}` }, 400)
  const value = parsed.value
  if (value.kind !== 'add') {
    const refused = reportRefused(await knownVenues(env), value)
    if (refused) return refused
  }
  await env.DB.batch(
    reportWrites(env, value, OWNER_HASH, OWNER_HASH, Date.now(), true),
  )
  return json({ ok: true }, 201)
}

export async function ownerPrices(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    'SELECT venue_id, item, brand, cents, seen FROM owner_prices ORDER BY venue_id, item, brand',
  ).all<OwnerRow>()
  return json({ prices: results }, 200)
}

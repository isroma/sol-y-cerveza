/** Pure rules of the price suggestions API: validation and consensus. */
import { BRANDS, ITEMS, type Brand, type Item } from '../../web/src/data/prices.ts'

/** Distinct people who must suggest the same price before the app shows it. */
export const THRESHOLD = 5
/** Suggestions older than this no longer count. */
export const WINDOW_DAYS = 365
/** Suggestions one person (hashed IP) may send per day. */
export const DAILY_LIMIT = 20
/** Plausible prices, in cents: anything outside is a typo or a joke. */
export const RANGE: Record<Item, readonly [number, number]> = {
  cana: [50, 600],
  tercio: [80, 800],
}

export type Suggestion = {
  venueId: string
  item: Item
  brand: Brand | null
  cents: number
}

/** A price the app shows: agreed by visitors (approximate) or saved by the owner (confirmed). */
export type CrowdPrice = Suggestion & { voters: number; last: string; confirmed: boolean }

const VENUE_ID =
  /^(osm:(node|way)\/\d+|overture:[0-9A-Za-z-]+|junta:[0-9a-f]{12}|review:[a-z0-9]+(-[a-z0-9]+)*)$/

function isItem(value: unknown): value is Item {
  return ITEMS.some((item) => item === value)
}

function isBrand(value: unknown): value is Brand {
  return BRANDS.some((brand) => brand === value)
}

/** The suggestion and Turnstile token in a request body, or why it is invalid. */
export function parseSuggestion(
  body: unknown,
): { ok: true; value: Suggestion; token: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body' }
  const { venueId, item, brand, cents, token } = body as Record<string, unknown>
  if (typeof venueId !== 'string' || !VENUE_ID.test(venueId))
    return { ok: false, error: 'venueId' }
  if (!isItem(item)) return { ok: false, error: 'item' }
  if (item === 'tercio' ? !isBrand(brand) : brand !== null)
    return { ok: false, error: 'brand' }
  const [min, max] = RANGE[item]
  if (typeof cents !== 'number' || !Number.isInteger(cents) || cents < min || cents > max)
    return { ok: false, error: 'cents' }
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096)
    return { ok: false, error: 'token' }
  return {
    ok: true,
    value: { venueId, item, brand: isBrand(brand) ? brand : null, cents },
    token,
  }
}

export type PriceGroup = {
  venue_id: string
  item: string
  brand: string
  cents: number
  voters: number
  last: string
}

/**
 * Prices with enough agreement: per venue, item and brand, the price most people
 * suggested, if at least THRESHOLD of them did (ties go to the most recent).
 */
export function consensus(groups: readonly PriceGroup[]): CrowdPrice[] {
  const best = new Map<string, PriceGroup>()
  for (const group of groups) {
    if (group.voters < THRESHOLD) continue
    const key = `${group.venue_id}|${group.item}|${group.brand}`
    const current = best.get(key)
    if (
      !current ||
      group.voters > current.voters ||
      (group.voters === current.voters && group.last > current.last)
    )
      best.set(key, group)
  }
  return [...best.values()]
    .flatMap((g): CrowdPrice[] => {
      if (!isItem(g.item)) return []
      const brand = isBrand(g.brand) ? g.brand : null
      return [
        {
          venueId: g.venue_id,
          item: g.item,
          brand,
          cents: g.cents,
          voters: g.voters,
          last: g.last,
          confirmed: false,
        },
      ]
    })
    .sort((a, b) =>
      `${a.venueId}|${a.item}|${a.brand ?? ''}` < `${b.venueId}|${b.item}|${b.brand ?? ''}` ? -1 : 1,
    )
}

/** Constant-time string comparison, for the admin token. */
export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** The CORS origin to send back, or null when `origin` is not allowed. */
export function allowedOrigin(origin: string | null, allowed: string): string | null {
  if (!origin) return null
  return allowed.split(',').map((o) => o.trim()).includes(origin) ? origin : null
}

export type OwnerRow = { venue_id: string; item: string; brand: string; cents: number; seen: string }

/** Owner prices as the app shows them; they replace visitor prices for the same item. */
export function withOwnerPrices(crowd: readonly CrowdPrice[], owner: readonly OwnerRow[]): CrowdPrice[] {
  const key = (p: { venueId: string; item: string; brand: string | null }) =>
    `${p.venueId}|${p.item}|${p.brand ?? ''}`
  const byKey = new Map(crowd.map((p) => [key(p), p]))
  for (const row of owner) {
    if (!isItem(row.item)) continue
    const brand = isBrand(row.brand) ? row.brand : null
    const price: CrowdPrice = {
      venueId: row.venue_id,
      item: row.item,
      brand,
      cents: row.cents,
      voters: 0,
      last: row.seen,
      confirmed: true,
    }
    byKey.set(key(price), price)
  }
  return [...byKey.values()].sort((a, b) => (key(a) < key(b) ? -1 : 1))
}

/** An owner price in a request body (`{venueId, item, brand, cents}`), or why it is invalid. */
export function parseOwnerPrice(
  body: unknown,
): { ok: true; value: Suggestion } | { ok: false; error: string } {
  const parsed = parseSuggestion(
    typeof body === 'object' && body !== null ? { ...body, token: 'owner' } : body,
  )
  return parsed.ok ? { ok: true, value: parsed.value } : parsed
}

/** Today as YYYY-MM-DD in Spain (the date a price was seen). */
export function madridDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now)
}

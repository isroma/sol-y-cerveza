/** Pure rules of the price suggestions API: validation and consensus. */
import {
  BRANDS,
  ITEMS,
  SUGGEST_RANGE,
  type Brand,
  type Item,
} from '../../web/src/data/prices.ts'
import { VENUE_ID } from '../../web/src/data/geo.ts'

/** Distinct people who must suggest the same price before the app shows it. */
export const THRESHOLD = 5
/** Suggestions older than this no longer count. */
export const WINDOW_DAYS = 365
/** Suggestions (re-votes included) one voter may send per day. */
export const DAILY_LIMIT = 20
/** Suggestions one network may send per day: stops address rotation inside a network. */
export const NETWORK_DAILY_LIMIT = 60
/** Suggestions one venue may receive per hour, from everyone: stops a burst on one bar. */
export const VENUE_HOURLY_LIMIT = 15
/** The rate-limit log keeps this long; the longest window above is a day. */
export const EVENT_RETENTION_HOURS = 48
/** The Turnstile action the app's price widget declares. */
export const TURNSTILE_ACTION = 'suggest'

export type Suggestion = {
  venueId: string
  item: Item
  brand: Brand | null
  cents: number
}

/** A price the app shows: agreed by visitors (approximate) or saved by the owner (confirmed). */
export type CrowdPrice = Suggestion & {
  voters: number
  last: string
  confirmed: boolean
}

function isItem(value: unknown): value is Item {
  return ITEMS.some((item) => item === value)
}

function isBrand(value: unknown): value is Brand {
  return BRANDS.some((brand) => brand === value)
}

/** The suggestion and Turnstile token in a request body, or why it is invalid. */
export function parseSuggestion(
  body: unknown,
):
  | { ok: true; value: Suggestion; token: string }
  | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'body' }
  const { venueId, item, brand, cents, token } = body as Record<string, unknown>
  if (typeof venueId !== 'string' || !VENUE_ID.test(venueId))
    return { ok: false, error: 'venueId' }
  if (!isItem(item)) return { ok: false, error: 'item' }
  if (item === 'tercio' ? !isBrand(brand) : brand !== null)
    return { ok: false, error: 'brand' }
  const [min, max] = SUGGEST_RANGE[item]
  if (
    typeof cents !== 'number' ||
    !Number.isInteger(cents) ||
    cents < min ||
    cents > max
  )
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
      `${a.venueId}|${a.item}|${a.brand ?? ''}` <
      `${b.venueId}|${b.item}|${b.brand ?? ''}`
        ? -1
        : 1,
    )
}

export type PriceResolution = {
  venueId: string
  item: Item
  /** '' for a caña, as stored. */
  brand: string
  cents: number
  status: 'accepted' | 'rejected'
}

/** An admin decision on a suggested price (`{venueId, item, brand, cents, status}`), or null. */
export function parsePriceResolution(body: unknown): PriceResolution | null {
  if (typeof body !== 'object' || body === null) return null
  const { venueId, item, brand, cents, status } = body as Record<
    string,
    unknown
  >
  if (typeof venueId !== 'string' || !VENUE_ID.test(venueId) || !isItem(item))
    return null
  if (brand !== null && typeof brand !== 'string') return null
  if (typeof cents !== 'number' || !Number.isInteger(cents)) return null
  if (status !== 'accepted' && status !== 'rejected') return null
  return { venueId, item, brand: brand ?? '', cents, status }
}

/** Constant-time string comparison, for the admin token. */
/** The owner's login (routes/login.ts): attempts one network may make in LOGIN_WINDOW_MINUTES. */
export const LOGIN_NETWORK_LIMIT = 5
export const LOGIN_WINDOW_MINUTES = 15
/** Login attempts from everyone together in an hour: a slow ceiling on guessing. */
export const LOGIN_HOURLY_LIMIT = 30

export function safeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a)
  const right = new TextEncoder().encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++)
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** The CORS origin to send back, or null when `origin` is not allowed. */
export function allowedOrigin(
  origin: string | null,
  allowed: string,
): string | null {
  if (!origin) return null
  return allowed
    .split(',')
    .map((o) => o.trim())
    .includes(origin)
    ? origin
    : null
}

export type OwnerRow = {
  venue_id: string
  item: string
  brand: string
  cents: number
  seen: string
}

/** Owner prices as the app shows them; they replace visitor prices for the same item. */
export function withOwnerPrices(
  crowd: readonly CrowdPrice[],
  owner: readonly OwnerRow[],
): CrowdPrice[] {
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
    typeof body === 'object' && body !== null
      ? { ...body, token: 'owner' }
      : body,
  )
  return parsed.ok ? { ok: true, value: parsed.value } : parsed
}

/** Today as YYYY-MM-DD in Spain (the date a price was seen). */
export function madridDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(
    now,
  )
}

/** Expands an IPv6 address to 8 hextets, or null when it isn't one. */
function ipv6Hextets(ip: string): number[] | null {
  if (!ip.includes(':') || ip.includes('%')) return null
  let text = ip
  // An embedded IPv4 tail (::ffff:1.2.3.4) becomes two hextets.
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  if (v4) {
    const octets = v4.slice(1).map(Number)
    if (octets.some((o) => o > 255)) return null
    const [a = 0, b = 0, c = 0, d = 0] = octets
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0] ?? '')
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [
    ...head,
    ...Array<string>(halves.length === 2 ? missing : 0).fill('0'),
    ...tail,
  ]
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null
  return groups.map((g) => parseInt(g, 16))
}

function ipv4Octets(ip: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!match) return null
  const octets = match.slice(1).map(Number)
  return octets.every((o) => o <= 255) ? octets : null
}

/**
 * Who is voting, at two levels: `voter` is one person (an IPv4 address, or the
 * IPv6 /64 a device gets to rotate through) and `network` is where they are (the
 * IPv4 /24 or IPv6 /48). Consensus counts networks, so a person who gets new
 * addresses (airplane mode, a new IPv6 address) still counts once.
 */
export function voterKeys(ip: string): { voter: string; network: string } {
  const v4 = ipv4Octets(ip)
  if (v4)
    return { voter: v4.join('.'), network: `${v4.slice(0, 3).join('.')}.0/24` }
  const v6 = ipv6Hextets(ip)
  if (v6) {
    // IPv4-mapped (::ffff:a.b.c.d) is really IPv4.
    if (v6.slice(0, 5).every((h) => h === 0) && v6[5] === 0xffff) {
      const [hi = 0, lo = 0] = v6.slice(6)
      return voterKeys([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'))
    }
    const prefix = (n: number) =>
      v6
        .slice(0, n)
        .map((h) => h.toString(16))
        .join(':')
    return { voter: `${prefix(4)}::/64`, network: `${prefix(3)}::/48` }
  }
  return { voter: 'unknown', network: 'unknown' }
}

/** Turnstile's test secrets (always pass, always fail, token spent): no hostname or action. */
export function isTestSecret(secret: string): boolean {
  return /^[123]x0{31}AA$/.test(secret)
}

/** Hostnames of a local `wrangler dev`, the only place a Turnstile test secret may pass. */
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

/**
 * Whether the request was sent to a local dev server. A test secret on a deployed
 * Worker (a misconfiguration: it lets every bot through) fails verification instead.
 */
export function isLocalRequest(url: string): boolean {
  try {
    return LOCAL_HOSTNAMES.includes(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The shortest IP_SALT the API accepts; a shorter one makes the hashes guessable. */
export const MIN_SALT_LENGTH = 16

/** Whether IP_SALT is set and long enough to hash addresses with. */
export function saltUsable(salt: string | undefined): salt is string {
  return typeof salt === 'string' && salt.length >= MIN_SALT_LENGTH
}

/**
 * Whether a Turnstile siteverify result is a pass: a success, issued by the
 * widget's `expectedAction` on one of our hostnames (test secrets skip those).
 */
export function turnstilePassed(
  result: unknown,
  allowedOrigins: string,
  testSecret: boolean,
  expectedAction: string,
): boolean {
  if (typeof result !== 'object' || result === null) return false
  const { success, hostname, action } = result as Record<string, unknown>
  if (success !== true) return false
  if (testSecret) return true
  if (action !== expectedAction || typeof hostname !== 'string') return false
  return allowedOrigins
    .split(',')
    .map((origin) => {
      try {
        return new URL(origin.trim()).hostname
      } catch {
        return ''
      }
    })
    .includes(hostname)
}

export type RecentCounts = { voter: number; network: number; venue: number }

/**
 * Which limit `parts` new events (one per suggestion or report) would break, or
 * null when they may all go in.
 */
export function limitHit(
  counts: RecentCounts,
  parts = 1,
): 'voter' | 'network' | 'venue' | null {
  if (counts.voter + parts > DAILY_LIMIT) return 'voter'
  if (counts.network + parts > NETWORK_DAILY_LIMIT) return 'network'
  if (counts.venue + parts > VENUE_HOURLY_LIMIT) return 'venue'
  return null
}

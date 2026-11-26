/**
 * POST /v1/changes: everything a visitor suggests for one venue from the
 * card's back, behind one Turnstile check. Each part is checked by the same
 * rules as its own endpoint (parseSuggestion, parseReport); `sun: true` is a
 * sun report (sun.ts), checked against the sun's position by the route.
 * `terrace` (yes/no) and `pin` (where the tables are) are the terrace reports
 * of ADR-0009 (#210); a pin with `terrace: false` contradicts itself.
 */
import { parseSuggestion, type Suggestion } from './logic.ts'
import { parseReport, type Report } from './reports.ts'
import { VENUE_ID } from '../../web/src/data/geo.ts'

/** The Turnstile action the card back's widget declares. */
export const CHANGE_TURNSTILE_ACTION = 'change'

export type Change = {
  venueId: string
  price: Suggestion | null
  /** A move, closed, a terrace answer and/or a tables pin, as venue reports. */
  reports: Report[]
  /** "The sun is on this terrace now" (ADR-0012). */
  sun: boolean
}

/**
 * The change and Turnstile token in a request body, or why it is invalid.
 * The owner's changes (`owner`) carry no token.
 */
export function parseChange(
  body: unknown,
  owner = false,
): { ok: true; value: Change; token: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'body' }
  const { venueId, token, price, move, closed, sun, terrace, pin } =
    body as Record<string, unknown>
  if (typeof venueId !== 'string') return { ok: false, error: 'venueId' }
  // The owner's changes need no bot check; the parts are parsed as a visitor's.
  const checked = owner ? 'owner' : token
  if (
    typeof checked !== 'string' ||
    checked.length === 0 ||
    checked.length > 4096
  )
    return { ok: false, error: 'token' }
  if (closed !== undefined && closed !== true)
    return { ok: false, error: 'closed' }
  if (sun !== undefined && sun !== true) return { ok: false, error: 'sun' }
  if (terrace !== undefined && typeof terrace !== 'boolean')
    return { ok: false, error: 'terrace' }
  // Tables at a spot on a venue with no terrace: refused, not guessed at.
  if (pin !== undefined && terrace === false)
    return { ok: false, error: 'pin with no terrace' }

  let suggestion: Suggestion | null = null
  if (price !== undefined) {
    if (typeof price !== 'object' || price === null)
      return { ok: false, error: 'price' }
    const parsed = parseSuggestion({ ...price, venueId, token: checked })
    if (!parsed.ok) return { ok: false, error: `price ${parsed.error}` }
    suggestion = parsed.value
  }

  const reports: Report[] = []
  if (move !== undefined) {
    if (typeof move !== 'object' || move === null)
      return { ok: false, error: 'move' }
    const parsed = parseReport({
      ...move,
      kind: 'move',
      venueId,
      token: checked,
    })
    if (!parsed.ok) return { ok: false, error: `move ${parsed.error}` }
    reports.push(parsed.value)
  }
  if (closed === true) {
    const parsed = parseReport({ kind: 'closed', venueId, token: checked })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    reports.push(parsed.value)
  }
  if (typeof terrace === 'boolean') {
    const parsed = parseReport({
      kind: 'terrace',
      venueId,
      terrace,
      token: checked,
    })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    reports.push(parsed.value)
  }
  if (pin !== undefined) {
    if (typeof pin !== 'object' || pin === null)
      return { ok: false, error: 'pin' }
    const parsed = parseReport({
      ...pin,
      kind: 'pin',
      venueId,
      token: checked,
    })
    if (!parsed.ok) return { ok: false, error: `pin ${parsed.error}` }
    reports.push(parsed.value)
  }

  if (!suggestion && reports.length === 0 && sun !== true)
    return { ok: false, error: 'empty' }
  // parseSuggestion and parseReport have checked venueId when either ran.
  if (!VENUE_ID.test(venueId)) return { ok: false, error: 'venueId' }
  return {
    ok: true,
    value: { venueId, price: suggestion, reports, sun: sun === true },
    token: checked,
  }
}

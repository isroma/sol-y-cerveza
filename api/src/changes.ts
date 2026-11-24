/**
 * POST /v1/changes: everything a visitor suggests for one venue from the
 * card's back, behind one Turnstile check. Each part is checked by the same
 * rules as its own endpoint (parseSuggestion, parseReport).
 */
import { parseSuggestion, type Suggestion } from './logic.ts'
import { parseReport, type Report } from './reports.ts'

/** The Turnstile action the card back's widget declares. */
export const CHANGE_TURNSTILE_ACTION = 'change'

export type Change = {
  venueId: string
  price: Suggestion | null
  /** A move and/or closed, as venue reports. */
  reports: Report[]
}

/** The change and Turnstile token in a request body, or why it is invalid. */
export function parseChange(
  body: unknown,
): { ok: true; value: Change; token: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'body' }
  const { venueId, token, price, move, closed } = body as Record<
    string,
    unknown
  >
  if (typeof venueId !== 'string') return { ok: false, error: 'venueId' }
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096)
    return { ok: false, error: 'token' }
  if (closed !== undefined && closed !== true)
    return { ok: false, error: 'closed' }

  let suggestion: Suggestion | null = null
  if (price !== undefined) {
    if (typeof price !== 'object' || price === null)
      return { ok: false, error: 'price' }
    const parsed = parseSuggestion({ ...price, venueId, token })
    if (!parsed.ok) return { ok: false, error: `price ${parsed.error}` }
    suggestion = parsed.value
  }

  const reports: Report[] = []
  if (move !== undefined) {
    if (typeof move !== 'object' || move === null)
      return { ok: false, error: 'move' }
    const parsed = parseReport({ ...move, kind: 'move', venueId, token })
    if (!parsed.ok) return { ok: false, error: `move ${parsed.error}` }
    reports.push(parsed.value)
  }
  if (closed === true) {
    const parsed = parseReport({ kind: 'closed', venueId, token })
    if (!parsed.ok) return { ok: false, error: parsed.error }
    reports.push(parsed.value)
  }

  if (!suggestion && reports.length === 0) return { ok: false, error: 'empty' }
  // parseSuggestion and parseReport have checked venueId when either ran.
  return { ok: true, value: { venueId, price: suggestion, reports }, token }
}

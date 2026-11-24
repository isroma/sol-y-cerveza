import type { LatLon, Terrace } from '../data/terraces.ts'
import { PRICES_API, TURNSTILE_SITE_KEY } from '../prices/crowd.ts'

/**
 * Visitor venue reports (ADR-0008): sent to the API's `POST /v1/reports`,
 * reviewed by the owner in the admin before anything changes on the map.
 */

/** The Turnstile action the API expects for reports (not the prices' `suggest`). */
export const REPORT_ACTION = 'report'

/** Mirrors the API's checks (api/src/reports.ts), so the visitor hears why before sending. */
export const BADAJOZ_BBOX = {
  south: 38.84,
  west: -7.04,
  north: 38.92,
  east: -6.92,
} as const
export const MAX_MOVE_M = 500
export const MAX_PIN_M = 150
export const NAME_MIN = 2
export const NAME_MAX = 60

export type VenueKind = Terrace['kind']

export type Report =
  | { kind: 'terrace'; venueId: string; terrace: boolean }
  | { kind: 'closed'; venueId: string }
  | { kind: 'move' | 'pin'; venueId: string; lat: number; lon: number }
  | {
      kind: 'add'
      name: string
      venueKind: VenueKind
      terrace: boolean
      lat: number
      lon: number
    }

export type ReportResult = 'ok' | 'rate-limited' | 'bot' | 'error'

export const RESULT_TEXT: Record<ReportResult, string> = {
  ok: 'Gracias. Lo revisaremos antes de publicarlo.',
  'rate-limited':
    'Hay demasiados avisos desde tu conexión o para este bar. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

/** Reports need the API and a Turnstile site key in this build. */
export const CAN_REPORT = PRICES_API !== null && TURNSTILE_SITE_KEY !== null

export async function sendReport(
  report: Report,
  token: string,
): Promise<ReportResult> {
  if (!PRICES_API) return 'error'
  try {
    const response = await fetch(`${PRICES_API}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...report, token }),
    })
    if (response.ok) return 'ok'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return 'bot'
    return 'error'
  } catch {
    return 'error'
  }
}

/** Commas, quotes and line breaks become spaces; whitespace collapses (as the API does). */
export function cleanName(name: string): string {
  return name
    .replace(/[,"\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Metres between two points (equirectangular: plenty inside one city). */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * 6_371_000
}

/** What a picker is placing: a venue's terrace or door, or a missing bar. */
export type Pick =
  | {
      kind: 'pin' | 'move'
      venueId: string
      name: string
      /** The published venue position: the API measures distances from it. */
      from: LatLon
      /** Where the picker opens: the terrace (pin) or the venue (move). */
      start: LatLon
    }
  | { kind: 'add' }

/** Why the map centre can't be sent for this pick, in Spanish, or null when it can. */
export function pickProblem(pick: Pick, at: LatLon): string | null {
  const b = BADAJOZ_BBOX
  if (
    at.lat < b.south ||
    at.lat > b.north ||
    at.lon < b.west ||
    at.lon > b.east
  )
    return 'Ese punto está fuera de Badajoz.'
  if (pick.kind === 'pin' && distanceM(pick.from, at) > MAX_PIN_M)
    return `La terraza tiene que estar a menos de ${MAX_PIN_M} m del bar.`
  if (pick.kind === 'move' && distanceM(pick.from, at) > MAX_MOVE_M)
    return `Tiene que estar a menos de ${MAX_MOVE_M} m de donde lo tenemos.`
  return null
}

/** The report for a pick at the map centre (positions rounded to 6 decimals). */
export function pickReport(
  pick: Pick,
  at: LatLon,
  added: { name: string; venueKind: VenueKind; terrace: boolean },
): Report {
  const lat = Math.round(at.lat * 1e6) / 1e6
  const lon = Math.round(at.lon * 1e6) / 1e6
  if (pick.kind === 'add')
    return {
      kind: 'add',
      name: cleanName(added.name),
      venueKind: added.venueKind,
      terrace: added.terrace,
      lat,
      lon,
    }
  return { kind: pick.kind, venueId: pick.venueId, lat, lon }
}

/**
 * A missing bar's name the API accepts: 2–60 characters after cleaning, a
 * letter, the punctuation names use, nothing that looks like a link.
 */
export function nameOk(name: string): boolean {
  const clean = cleanName(name)
  if (clean.length < NAME_MIN || clean.length > NAME_MAX) return false
  if (/https?:|www\.|\.(com|es|net|org)\b/i.test(clean)) return false
  if (!/\p{L}/u.test(clean)) return false
  return /^[\p{L}\p{M}0-9 '’&.·ºª()!¡?¿+/-]+$/u.test(clean)
}

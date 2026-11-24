/**
 * Pure rules of visitor venue reports (ADR-0008, issues #201 and #210):
 * validation of `POST /v1/reports` and grouping for the admin queue.
 */

/** The Turnstile action the app's report widget declares. */
export const REPORT_ACTION = 'report'

/** Positions must fall inside Badajoz (mirrors BADAJOZ_BBOX in pipeline/src/solycerveza/geo.py). */
export const BADAJOZ_BBOX = { south: 38.84, west: -7.04, north: 38.92, east: -6.92 } as const

/** A moved venue is a correction, not a relocation. */
export const MAX_MOVE_M = 500
/** A terrace sits next to its venue (the build pairs terraces within 40 m; leave room for a plaza). */
export const MAX_PIN_M = 150

export const NAME_MIN = 2
export const NAME_MAX = 60

export const VENUE_KINDS = ['bar', 'pub', 'cafe', 'restaurant', 'biergarten'] as const
export type VenueKind = (typeof VENUE_KINDS)[number]

/** The caps' venue key for new-venue reports: all of them share one hourly cap. */
export const NEW_VENUE_KEY = 'new'

export const REPORT_KINDS = ['move', 'closed', 'add', 'terrace', 'pin'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

type LatLon = { lat: number; lon: number }

export type Report =
  | { kind: 'move'; venueId: string; lat: number; lon: number }
  | { kind: 'closed'; venueId: string }
  | { kind: 'terrace'; venueId: string; terrace: boolean }
  | { kind: 'pin'; venueId: string; lat: number; lon: number }
  | { kind: 'add'; name: string; venueKind: VenueKind; terrace: boolean; lat: number; lon: number }

const VENUE_ID =
  /^(osm:(node|way)\/\d+|overture:[0-9A-Za-z-]+|junta:[0-9a-f]{12}|review:[a-z0-9]+(-[a-z0-9]+)*)$/

/** Commas, quotes and line breaks become spaces (the review CSV is unquoted); whitespace collapses. */
export function cleanName(name: string): string {
  return name
    .replace(/[,"\n\r\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A bar's name: letters and the punctuation names use; no links, no addresses. */
function validName(name: string): boolean {
  if (name.length < NAME_MIN || name.length > NAME_MAX) return false
  if (/https?:|www\.|\.(com|es|net|org)\b/i.test(name)) return false
  if (!/\p{L}/u.test(name)) return false
  return /^[\p{L}\p{M}0-9 '’&.·ºª()!¡?¿+/-]+$/u.test(name)
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

function position(lat: unknown, lon: unknown): LatLon | null {
  if (typeof lat !== 'number' || typeof lon !== 'number') return null
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const b = BADAJOZ_BBOX
  if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return null
  return { lat: round6(lat), lon: round6(lon) }
}

function isVenueKind(value: unknown): value is VenueKind {
  return VENUE_KINDS.some((kind) => kind === value)
}

function isReportKind(value: unknown): value is ReportKind {
  return REPORT_KINDS.some((kind) => kind === value)
}

/** The report and Turnstile token in a request body, or the field that is invalid. */
export function parseReport(
  body: unknown,
): { ok: true; value: Report; token: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'body' }
  const b = body as Record<string, unknown>
  if (!isReportKind(b['kind'])) return { ok: false, error: 'kind' }
  const token = b['token']
  const kind = b['kind']
  let value: Report
  if (kind === 'add') {
    const name = typeof b['name'] === 'string' ? cleanName(b['name']) : ''
    if (!validName(name)) return { ok: false, error: 'name' }
    if (!isVenueKind(b['venueKind'])) return { ok: false, error: 'venueKind' }
    if (typeof b['terrace'] !== 'boolean') return { ok: false, error: 'terrace' }
    const at = position(b['lat'], b['lon'])
    if (!at) return { ok: false, error: 'position' }
    value = { kind, name, venueKind: b['venueKind'], terrace: b['terrace'], ...at }
  } else {
    const venueId = b['venueId']
    if (typeof venueId !== 'string' || !VENUE_ID.test(venueId))
      return { ok: false, error: 'venueId' }
    if (kind === 'closed') value = { kind, venueId }
    else if (kind === 'terrace') {
      if (typeof b['terrace'] !== 'boolean') return { ok: false, error: 'terrace' }
      value = { kind, venueId, terrace: b['terrace'] }
    } else {
      const at = position(b['lat'], b['lon'])
      if (!at) return { ok: false, error: 'position' }
      value = { kind, venueId, ...at }
    }
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096)
    return { ok: false, error: 'token' }
  return { ok: true, value, token }
}

/** Metres between two points (equirectangular: plenty inside one city). */
export function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * 6_371_000
}

/**
 * Why a venue report doesn't fit the published venue at `venue` (null when
 * the venue is unknown), or null when it fits. New-venue reports need no venue.
 */
export function venueProblem(report: Report, venue: LatLon | null): string | null {
  if (report.kind === 'add') return null
  if (!venue) return 'unknown venue'
  if (report.kind === 'move' && distanceM(venue, report) > MAX_MOVE_M)
    return `invalid position: more than ${MAX_MOVE_M} m from the venue`
  if (report.kind === 'pin' && distanceM(venue, report) > MAX_PIN_M)
    return `invalid position: more than ${MAX_PIN_M} m from the venue`
  return null
}

/** The key the shared caps (suggestion_events) count a report against. */
export function capKey(report: Report): string {
  return report.kind === 'add' ? NEW_VENUE_KEY : report.venueId
}

/** A report as stored in D1 (`reports`). */
export type ReportRow = {
  id: number
  kind: string
  venue_id: string
  lat: number | null
  lon: number | null
  name: string | null
  venue_kind: string | null
  terrace: number | null
  net_hash: string
  created_at: string
}

/** The columns a report fills; the rest stay null. */
export function reportColumns(report: Report): {
  venueId: string
  lat: number | null
  lon: number | null
  name: string | null
  venueKind: string | null
  terrace: number | null
} {
  switch (report.kind) {
    case 'add':
      return {
        venueId: '',
        lat: report.lat,
        lon: report.lon,
        name: report.name,
        venueKind: report.venueKind,
        terrace: report.terrace ? 1 : 0,
      }
    case 'closed':
      return { venueId: report.venueId, lat: null, lon: null, name: null, venueKind: null, terrace: null }
    case 'terrace':
      return {
        venueId: report.venueId,
        lat: null,
        lon: null,
        name: null,
        venueKind: null,
        terrace: report.terrace ? 1 : 0,
      }
    case 'move':
    case 'pin':
      return { venueId: report.venueId, lat: report.lat, lon: report.lon, name: null, venueKind: null, terrace: null }
  }
}

type Meta = { ids: number[]; reporters: number; last: string }

/** An entry of the admin's reports queue (`GET /v1/admin/reports`). */
export type QueueEntry = Meta &
  (
    | { kind: 'closed'; venueId: string }
    | { kind: 'terrace'; venueId: string; terrace: boolean }
    | { kind: 'move' | 'pin'; venueId: string; lat: number; lon: number }
    | { kind: 'add'; name: string; venueKind: VenueKind; terrace: boolean; lat: number; lon: number }
  )

/**
 * Pending reports as the admin queue lists them: `closed` grouped per venue,
 * `terrace` per venue and answer (so the yes and no counts show), the rest
 * one entry per row. `reporters` counts distinct networks, as for prices.
 * Most reporters first, then the most recent: consensus raises priority and
 * applies nothing by itself.
 */
export function groupReports(rows: readonly ReportRow[]): QueueEntry[] {
  const groups = new Map<string, { entry: QueueEntry; nets: Set<string> }>()
  for (const row of rows) {
    const entry = toEntry(row)
    if (!entry) continue
    const key =
      entry.kind === 'closed'
        ? `closed|${entry.venueId}`
        : entry.kind === 'terrace'
          ? `terrace|${entry.venueId}|${entry.terrace}`
          : `row|${row.id}`
    const group = groups.get(key)
    if (!group) {
      groups.set(key, { entry, nets: new Set([row.net_hash]) })
      continue
    }
    group.entry.ids.push(row.id)
    group.nets.add(row.net_hash)
    if (row.created_at > group.entry.last) group.entry.last = row.created_at
  }
  return [...groups.values()]
    .map(({ entry, nets }) => ({ ...entry, ids: [...entry.ids].sort((a, b) => a - b), reporters: nets.size }))
    .sort((a, b) =>
      b.reporters !== a.reporters ? b.reporters - a.reporters : a.last < b.last ? 1 : a.last > b.last ? -1 : 0,
    )
}

function toEntry(row: ReportRow): QueueEntry | null {
  const meta: Meta = { ids: [row.id], reporters: 1, last: row.created_at }
  const at = row.lat !== null && row.lon !== null ? { lat: row.lat, lon: row.lon } : null
  switch (row.kind) {
    case 'closed':
      return { ...meta, kind: 'closed', venueId: row.venue_id }
    case 'terrace':
      return row.terrace === null ? null : { ...meta, kind: 'terrace', venueId: row.venue_id, terrace: row.terrace === 1 }
    case 'move':
    case 'pin':
      return at ? { ...meta, kind: row.kind, venueId: row.venue_id, ...at } : null
    case 'add':
      if (!at || row.name === null || !isVenueKind(row.venue_kind)) return null
      return { ...meta, kind: 'add', name: row.name, venueKind: row.venue_kind, terrace: row.terrace === 1, ...at }
    default:
      return null
  }
}

/** The ids and status of `POST /v1/admin/reports/resolve`, or null when invalid. */
export function parseResolution(body: unknown): { ids: number[]; status: 'accepted' | 'rejected' } | null {
  if (typeof body !== 'object' || body === null) return null
  const { ids, status } = body as Record<string, unknown>
  if (status !== 'accepted' && status !== 'rejected') return null
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) return null
  const numbers: number[] = []
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null
    numbers.push(id)
  }
  return { ids: numbers, status }
}

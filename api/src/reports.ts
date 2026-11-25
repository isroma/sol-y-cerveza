/**
 * Pure rules of venue reports from visitors: validation and the admin queue.
 * `move`, `closed`, `add` (#201); `terrace` yes/no and `pin`, where the
 * terrace is (#210, ADR-0009).
 */
import {
  BADAJOZ_BBOX,
  cleanVenueName,
  VENUE_ID,
  type LatLon,
} from '../../web/src/data/geo.ts'

/** The Turnstile action the app's report widget declares. */
export const REPORT_TURNSTILE_ACTION = 'report'
/**
 * The rate-limit venue key an `add` counts against (it has no venue yet): its
 * position's cell, rounded to 2 decimals (about 1 km), so missing-venue reports
 * in one part of town don't use up every other part's hourly cap. Never a venue
 * id, which always has a source prefix (`osm:` and so on).
 */
export function newVenueKey({ lat, lon }: LatLon): string {
  return `new:${lat.toFixed(2)},${lon.toFixed(2)}`
}
/** A `move` is a correction, not a relocation: at most this far from the published position. */
export const MAX_MOVE_METRES = 500
/** A terrace sits by its venue: a `pin` at most this far from the published venue position. */
export const MAX_PIN_METRES = 150
/**
 * Removes the voter's pending report of one kind for a venue, before its
 * replacement goes in (binds: kind, venue id, voter hash; never an `add`).
 * `kind != 'add'` repeats the condition of the partial unique index
 * `venue_reports_one_open`, so SQLite can use it: without it the statement
 * reads every pending report.
 */
export const DELETE_OPEN_REPORT = `DELETE FROM venue_reports
  WHERE status = 'pending' AND kind != 'add'
    AND kind = ? AND venue_id = ? AND voter_hash = ?`
export const VENUE_KINDS = [
  'bar',
  'pub',
  'cafe',
  'restaurant',
  'biergarten',
] as const

export type VenueKind = (typeof VENUE_KINDS)[number]

export type Report =
  | { kind: 'move'; venueId: string; lat: number; lon: number }
  | { kind: 'closed'; venueId: string }
  | {
      kind: 'add'
      name: string
      venueKind: VenueKind
      terrace: boolean
      lat: number
      lon: number
    }
  | { kind: 'terrace'; venueId: string; terrace: boolean }
  | { kind: 'pin'; venueId: string; lat: number; lon: number }

/** How far a report's position may be from the published venue, or null when it has none to check. */
export function maxDistance(report: Report): number | null {
  if (report.kind === 'move') return MAX_MOVE_METRES
  if (report.kind === 'pin') return MAX_PIN_METRES
  return null
}

function isVenueKind(value: unknown): value is VenueKind {
  return VENUE_KINDS.some((kind) => kind === value)
}

function coordinate(value: unknown, min: number, max: number): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  )
    return null
  return Math.round(value * 1e6) / 1e6
}

/** The report and Turnstile token in a request body, or why it is invalid. */
export function parseReport(
  body: unknown,
): { ok: true; value: Report; token: string } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, error: 'body' }
  const { kind, venueId, lat, lon, name, venueKind, terrace, token } =
    body as Record<string, unknown>
  if (
    kind !== 'move' &&
    kind !== 'closed' &&
    kind !== 'add' &&
    kind !== 'terrace' &&
    kind !== 'pin'
  )
    return { ok: false, error: 'kind' }
  if (
    kind !== 'add' &&
    (typeof venueId !== 'string' || !VENUE_ID.test(venueId))
  )
    return { ok: false, error: 'venueId' }
  // Reports must point inside Badajoz.
  const point = {
    lat: coordinate(lat, BADAJOZ_BBOX.south, BADAJOZ_BBOX.north),
    lon: coordinate(lon, BADAJOZ_BBOX.west, BADAJOZ_BBOX.east),
  }
  const placed = kind === 'move' || kind === 'add' || kind === 'pin'
  if (placed && point.lat === null) return { ok: false, error: 'lat' }
  if (placed && point.lon === null) return { ok: false, error: 'lon' }
  if (kind === 'terrace' && typeof terrace !== 'boolean')
    return { ok: false, error: 'terrace' }
  const cleaned = typeof name === 'string' ? cleanVenueName(name) : ''
  if (kind === 'add') {
    if (cleaned.length < 2 || cleaned.length > 60 || /http|www/i.test(cleaned))
      return { ok: false, error: 'name' }
    if (!isVenueKind(venueKind)) return { ok: false, error: 'venueKind' }
    if (typeof terrace !== 'boolean') return { ok: false, error: 'terrace' }
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096)
    return { ok: false, error: 'token' }

  const id = typeof venueId === 'string' ? venueId : ''
  const position = { lat: point.lat ?? 0, lon: point.lon ?? 0 }
  if (kind === 'closed')
    return { ok: true, value: { kind, venueId: id }, token }
  if (kind === 'move' || kind === 'pin')
    return { ok: true, value: { kind, venueId: id, ...position }, token }
  if (kind === 'terrace')
    return {
      ok: true,
      value: { kind, venueId: id, terrace: terrace === true },
      token,
    }
  return {
    ok: true,
    value: {
      kind,
      name: cleaned,
      venueKind: isVenueKind(venueKind) ? venueKind : 'bar',
      terrace: terrace === true,
      ...position,
    },
    token,
  }
}

/** A row of `venue_reports`, as the admin query reads it. */
export type ReportRow = {
  id: number
  kind: string
  venue_id: string
  name: string
  venue_kind: string
  lat: number | null
  lon: number | null
  terrace: number | null
  net_hash: string
  created_at: string
  /** 1 for the owner's own change, which the admin applies without review. */
  by_owner: number
}

export type QueueEntry =
  | {
      ids: number[]
      kind: 'closed'
      venueId: string
      reporters: number
      last: string
      /** Includes the owner's own change: the admin applies it without review. */
      owner: boolean
    }
  | {
      ids: number[]
      kind: 'move' | 'pin'
      venueId: string
      lat: number
      lon: number
      reporters: number
      last: string
      /** Includes the owner's own change: the admin applies it without review. */
      owner: boolean
    }
  | {
      ids: number[]
      kind: 'add'
      name: string
      venueKind: string
      terrace: boolean
      lat: number
      lon: number
      reporters: number
      last: string
      /** Includes the owner's own change: the admin applies it without review. */
      owner: boolean
    }
  | {
      ids: number[]
      kind: 'terrace'
      venueId: string
      terrace: boolean
      reporters: number
      last: string
      /** Includes the owner's own change: the admin applies it without review. */
      owner: boolean
    }

type Group = {
  ids: number[]
  nets: Set<string>
  last: string
  owner: boolean
}

/**
 * The admin's review queue from pending rows: `closed` grouped per venue and
 * `terrace` per venue and answer (reporters = distinct networks, so the yes and
 * no counts both show), `move`, `pin` and `add` one entry per row; most
 * reporters first, then newest. Agreement only sorts the queue: nothing applies
 * by itself (ADR-0009), except that the admin applies the owner's changes, which
 * come first.
 */
export function reportQueue(rows: readonly ReportRow[]): QueueEntry[] {
  const closed = new Map<string, Group>()
  const answers = new Map<
    string,
    Group & { venueId: string; terrace: boolean }
  >()
  const entries: QueueEntry[] = []
  const join = (group: Group, row: ReportRow) => {
    group.ids.push(row.id)
    group.nets.add(row.net_hash)
    if (row.created_at > group.last) group.last = row.created_at
    if (row.by_owner === 1) group.owner = true
  }
  for (const row of rows) {
    if (row.kind === 'closed') {
      const group = closed.get(row.venue_id) ?? {
        ids: [],
        nets: new Set(),
        last: '',
        owner: false,
      }
      join(group, row)
      closed.set(row.venue_id, group)
      continue
    }
    if (row.kind === 'terrace') {
      const terrace = row.terrace === 1
      const key = `${row.venue_id}|${terrace}`
      const group = answers.get(key) ?? {
        ids: [],
        nets: new Set(),
        last: '',
        owner: false,
        venueId: row.venue_id,
        terrace,
      }
      join(group, row)
      answers.set(key, group)
      continue
    }
    const base = {
      ids: [row.id],
      lat: row.lat ?? 0,
      lon: row.lon ?? 0,
      reporters: 1,
      last: row.created_at,
      owner: row.by_owner === 1,
    }
    if (row.kind === 'move' || row.kind === 'pin')
      entries.push({ ...base, kind: row.kind, venueId: row.venue_id })
    if (row.kind === 'add')
      entries.push({
        ...base,
        kind: 'add',
        name: row.name,
        venueKind: row.venue_kind,
        terrace: row.terrace === 1,
      })
  }
  for (const [venueId, group] of closed)
    entries.push({
      ids: group.ids.sort((a, b) => a - b),
      kind: 'closed',
      venueId,
      reporters: group.nets.size,
      last: group.last,
      owner: group.owner,
    })
  for (const group of answers.values())
    entries.push({
      ids: group.ids.sort((a, b) => a - b),
      kind: 'terrace',
      venueId: group.venueId,
      terrace: group.terrace,
      reporters: group.nets.size,
      last: group.last,
      owner: group.owner,
    })
  // The owner's changes first: the admin applies them as it loads.
  return entries.sort((a, b) =>
    a.owner !== b.owner
      ? Number(b.owner) - Number(a.owner)
      : b.reporters !== a.reporters
        ? b.reporters - a.reporters
        : a.last < b.last
          ? 1
          : a.last > b.last
            ? -1
            : 0,
  )
}

/** A resolution in a request body (`{ids, status}`), or null when it is invalid. */
export function parseResolution(
  body: unknown,
): { ids: number[]; status: 'accepted' | 'rejected' } | null {
  if (typeof body !== 'object' || body === null) return null
  const { ids, status } = body as Record<string, unknown>
  if (status !== 'accepted' && status !== 'rejected') return null
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) return null
  const valid: number[] = []
  for (const id of ids) {
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return null
    valid.push(id)
  }
  return { ids: valid, status }
}

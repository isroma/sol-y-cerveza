/**
 * Pure rules of sun reports (issue #364, ADR-0012): where the sun is when a
 * visitor says it is on a terrace, and how reports become horizon corrections.
 *
 * A report made with the sun at azimuth A and altitude H says the terrace's
 * horizon near A is below H. A correction caps the horizon bins within
 * SUN_SPREAD_DEGREES of A at H - SUN_MARGIN_DEGREES, in the season the report
 * was made in; the app uses the lower of the model's horizon and the cap.
 */
import { getPosition } from 'suncalc'
import type { LatLon } from '../../web/src/data/geo.ts'
import { madridDate } from './logic.ts'

/** Distinct networks that must report sun in a slice of sky before it is served. */
export const SUN_THRESHOLD = 3
/** A report counts for the horizon bins this many degrees either side of the sun. */
export const SUN_SPREAD_DEGREES = 5
/** The cap sits this far below the sun's altitude, so it holds as the sun's path drops. */
export const SUN_MARGIN_DEGREES = 2
/** Reports, and the owner's rejections, stop counting after this. */
export const SUN_WINDOW_DAYS = 365
/** Below this altitude (degrees) a sun report is refused: "sun is down". */
export const MIN_SUN_ALTITUDE = 2

/**
 * The leaf-off period, by Madrid date, both ends inclusive. Mirrors LEAF_OFF in
 * web/src/sun/leafOff.ts (ADR-0007), which can't be imported here: its file
 * pulls in the app's zod schemas, which the Worker doesn't have (sun.test.ts
 * checks the two stay the same).
 */
export const LEAF_OFF = { from: '12-01', until: '03-15' } as const

/** True when `date` (YYYY-MM-DD, Madrid) is inside the leaf-off period, as isLeafOff in the app. */
export function isLeafOff(date: string): boolean {
  const monthDay = /^\d{4}-(\d{2}-\d{2})$/.exec(date)?.[1]
  if (monthDay === undefined) return false
  return monthDay >= LEAF_OFF.from || monthDay <= LEAF_OFF.until
}

/**
 * The sun's position in degrees (compass azimuth in [0, 360), refraction-corrected
 * altitude), as sunPosition in web/src/sun/sunState.ts computes it with the same
 * suncalc.
 */
export function sunPosition(
  instant: Date,
  location: LatLon,
): { azimuth: number; altitude: number } {
  const { altitude, azimuth } = getPosition(instant, location.lat, location.lon)
  return { azimuth, altitude }
}

/** Horizon bin for a compass azimuth: bin i covers [i - 0.5°, i + 0.5°), as in the app. */
export function horizonBin(azimuth: number): number {
  return ((Math.round(azimuth) % 360) + 360) % 360
}

/** Degrees between two bins, the short way round (359 and 0 are 1 apart). */
export function binDistance(a: number, b: number): number {
  const d = (((a - b) % 360) + 360) % 360
  return Math.min(d, 360 - d)
}

/** The cap for a sighting at `altitude` degrees, in tenths of a degree: margin off, floored. */
export function capTenths(altitude: number): number {
  // The epsilon keeps 27.1 - 2 from flooring to 250 through binary rounding.
  return Math.max(0, Math.floor((altitude - SUN_MARGIN_DEGREES) * 10 + 1e-9))
}

export type Sighting = {
  azimuth: number
  altitude: number
  bin: number
  leafOff: boolean
}

/**
 * Where the sun is at `now` seen from a venue at `position`, or why a sun
 * report there is refused: the venue has no position, or the sun is below
 * MIN_SUN_ALTITUDE. The season is the Madrid date of `now`.
 */
export function sighting(
  position: LatLon | undefined,
  now: Date,
): { ok: true; value: Sighting } | { ok: false; error: string } {
  if (
    !position ||
    !Number.isFinite(position.lat) ||
    !Number.isFinite(position.lon)
  )
    return { ok: false, error: 'venue has no position' }
  const { azimuth, altitude } = sunPosition(now, position)
  if (!(altitude >= MIN_SUN_ALTITUDE))
    return { ok: false, error: 'sun is down' }
  return {
    ok: true,
    value: {
      azimuth,
      altitude,
      bin: horizonBin(azimuth),
      leafOff: isLeafOff(madridDate(now)),
    },
  }
}

/** A sun_reports row as the queries read it. */
export type SunRow = {
  id: number
  venue_id: string
  azimuth: number
  altitude: number
  leaf_off: number
  net_hash: string
  created_at: string
  status: string
}

/** A sun_rejections row: a slice the owner rejected. */
export type RejectionRow = {
  venue_id: string
  leaf_off: number
  bin: number
  rejected_at: string
}

/** One run of GET /v1/sun. */
export type SunCorrection = {
  venueId: string
  leafOff: boolean
  /** Inclusive horizon bins; a run across north has from > to. */
  from: number
  to: number
  /** The cap in tenths of a degree, margin already off. */
  altitude: number
  confirmed: boolean
  /** Distinct networks behind the run. */
  reporters: number
  /** The newest report behind the run. */
  last: string
}

/** One venue and season of the admin's queue (GET /v1/admin/sun). */
export type SunQueueEntry = {
  ids: number[]
  venueId: string
  leafOff: boolean
  sightings: { id: number; azimuth: number; altitude: number; at: string }[]
  reporters: number
  /** Some of these reports are behind a consensus GET /v1/sun serves. */
  shown: boolean
  last: string
}

/** One report of GET /v1/admin/sun/accepted, for the admin's sun_corrections.csv. */
export type AcceptedSun = {
  id: number
  venueId: string
  leafOff: boolean
  /** Degrees, 1 decimal. */
  azimuth: number
  altitude: number
  at: string
}

/** A bin's cap and the reports behind it. */
type BinCap = { cap: number; rows: SunRow[] }

function since(now: number): string {
  return new Date(now - SUN_WINDOW_DAYS * 86400_000).toISOString()
}

const seasonKey = (venueId: string, leafOff: number) =>
  `${venueId}|${leafOff ? 1 : 0}`

function groupBySeason<T extends { venue_id: string; leaf_off: number }>(
  rows: readonly T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const key = seasonKey(row.venue_id, row.leaf_off)
    const group = groups.get(key)
    if (group) group.push(row)
    else groups.set(key, [row])
  }
  return groups
}

/** The reports within the spread of each bin (index 0..359). */
function rowsPerBin(rows: readonly SunRow[]): SunRow[][] {
  const bins: SunRow[][] = Array.from({ length: 360 }, () => [])
  for (const row of rows) {
    const centre = horizonBin(row.azimuth)
    for (let d = -SUN_SPREAD_DEGREES; d <= SUN_SPREAD_DEGREES; d++)
      bins[(centre + d + 360) % 360]?.push(row)
  }
  return bins
}

/** Each network once, at its lowest altitude, lowest first. */
function lowestPerNetwork(rows: readonly SunRow[]): number[] {
  const lowest = new Map<string, number>()
  for (const row of rows) {
    const current = lowest.get(row.net_hash)
    if (current === undefined || row.altitude < current)
      lowest.set(row.net_hash, row.altitude)
  }
  return [...lowest.values()].sort((a, b) => a - b)
}

/**
 * Visitor consensus for one venue and season: in each bin not blocked by a
 * rejection, with SUN_THRESHOLD networks or more reporting within the spread,
 * the cap at the SUN_THRESHOLD-th lowest altitude (the level that many
 * networks support).
 */
function consensusBins(
  rows: readonly SunRow[],
  blocked: ReadonlySet<number>,
): (BinCap | null)[] {
  return rowsPerBin(rows).map((inSpread, bin) => {
    if (blocked.has(bin)) return null
    const altitude = lowestPerNetwork(inSpread)[SUN_THRESHOLD - 1]
    return altitude === undefined
      ? null
      : { cap: capTenths(altitude), rows: inSpread }
  })
}

/** Accepted reports for one venue and season: one is enough, the lowest one sets the cap. */
function confirmedBins(rows: readonly SunRow[]): (BinCap | null)[] {
  return rowsPerBin(rows).map((inSpread) => {
    const altitude = lowestPerNetwork(inSpread)[0]
    return altitude === undefined
      ? null
      : { cap: capTenths(altitude), rows: inSpread }
  })
}

type Run = { from: number; to: number; cap: number; rows: SunRow[] }

/** Adjacent bins with the same cap as runs; a run that crosses north is one run. */
function runs(bins: readonly (BinCap | null)[]): Run[] {
  const found: Run[] = []
  let current: Run | null = null
  bins.forEach((bin, i) => {
    if (bin && current && current.cap === bin.cap && current.to === i - 1) {
      current.to = i
      current.rows.push(...bin.rows)
      return
    }
    current = bin ? { from: i, to: i, cap: bin.cap, rows: [...bin.rows] } : null
    if (current) found.push(current)
  })
  const first = found[0]
  const last = found.at(-1)
  if (
    first &&
    last &&
    first !== last &&
    first.from === 0 &&
    last.to === 359 &&
    first.cap === last.cap
  ) {
    found.shift()
    last.to = first.to
    last.rows.push(...first.rows)
  }
  return found
}

function correction(
  venueId: string,
  leafOff: boolean,
  confirmed: boolean,
  run: Run,
): SunCorrection {
  return {
    venueId,
    leafOff,
    from: run.from,
    to: run.to,
    altitude: run.cap,
    confirmed,
    reporters: new Set(run.rows.map((r) => r.net_hash)).size,
    last: run.rows.reduce((a, r) => (r.created_at > a ? r.created_at : a), ''),
  }
}

/** The bins the owner's rejections block, per venue and season. */
function blockedBins(
  rejections: readonly RejectionRow[],
  now: number,
): Map<string, Set<number>> {
  const from = since(now)
  const blocked = new Map<string, Set<number>>()
  for (const rejection of rejections) {
    if (rejection.rejected_at < from) continue
    const key = seasonKey(rejection.venue_id, rejection.leaf_off)
    const bins = blocked.get(key) ?? new Set<number>()
    for (let d = -SUN_SPREAD_DEGREES; d <= SUN_SPREAD_DEGREES; d++)
      bins.add((rejection.bin + d + 360) % 360)
    blocked.set(key, bins)
  }
  return blocked
}

/** The consensus bins of each venue and season, from reports in the window. */
function consensusBySeason(
  rows: readonly SunRow[],
  rejections: readonly RejectionRow[],
  now: number,
): Map<string, (BinCap | null)[]> {
  const from = since(now)
  const blocked = blockedBins(rejections, now)
  const live = rows.filter(
    (r) => r.status !== 'rejected' && r.created_at >= from,
  )
  const result = new Map<string, (BinCap | null)[]>()
  for (const [key, group] of groupBySeason(live))
    result.set(key, consensusBins(group, blocked.get(key) ?? new Set()))
  return result
}

/**
 * GET /v1/sun: per venue and season, runs of visitor consensus (`confirmed:
 * false`) and of accepted reports (`confirmed: true`), from reports in the
 * last SUN_WINDOW_DAYS. Sorted by venueId, leafOff, confirmed, from.
 */
export function sunCorrections(
  rows: readonly SunRow[],
  rejections: readonly RejectionRow[],
  now: number,
): SunCorrection[] {
  const from = since(now)
  const corrections: SunCorrection[] = []
  for (const [key, bins] of consensusBySeason(rows, rejections, now)) {
    const [venueId = '', season] = key.split('|')
    const leafOff = season === '1'
    for (const run of runs(bins))
      corrections.push(correction(venueId, leafOff, false, run))
  }
  const accepted = rows.filter(
    (r) => r.status === 'accepted' && r.created_at >= from,
  )
  for (const group of groupBySeason(accepted).values()) {
    const venueId = group[0]?.venue_id ?? ''
    const leafOff = Boolean(group[0]?.leaf_off)
    for (const run of runs(confirmedBins(group)))
      corrections.push(correction(venueId, leafOff, true, run))
  }
  return corrections.sort(
    (a, b) =>
      (a.venueId < b.venueId ? -1 : a.venueId > b.venueId ? 1 : 0) ||
      Number(a.leafOff) - Number(b.leafOff) ||
      Number(a.confirmed) - Number(b.confirmed) ||
      a.from - b.from,
  )
}

const oneDecimal = (degrees: number) => Math.round(degrees * 10) / 10

/**
 * GET /v1/admin/sun/accepted: every accepted report (visitors' and the
 * owner's) in the last SUN_WINDOW_DAYS, sorted by id, degrees to 1 decimal.
 */
export function acceptedSun(
  rows: readonly SunRow[],
  now: number,
): AcceptedSun[] {
  const from = since(now)
  return rows
    .filter((r) => r.status === 'accepted' && r.created_at >= from)
    .sort((a, b) => a.id - b.id)
    .map((r) => ({
      id: r.id,
      venueId: r.venue_id,
      leafOff: Boolean(r.leaf_off),
      azimuth: oneDecimal(r.azimuth),
      altitude: oneDecimal(r.altitude),
      at: r.created_at,
    }))
}

/**
 * The admin's queue: pending reports, one entry per venue and season, most
 * reporters (distinct networks) first, then newest. `rows` are every report
 * not rejected, so `shown` can tell which pending ones are behind a consensus
 * GET /v1/sun serves.
 */
export function sunQueue(
  rows: readonly SunRow[],
  rejections: readonly RejectionRow[],
  now: number,
): SunQueueEntry[] {
  const consensus = consensusBySeason(rows, rejections, now)
  const pending = rows.filter((r) => r.status === 'pending')
  const entries: SunQueueEntry[] = []
  for (const [key, group] of groupBySeason(pending)) {
    const bins = consensus.get(key) ?? []
    const sorted = [...group].sort((a, b) => a.id - b.id)
    entries.push({
      ids: sorted.map((r) => r.id),
      venueId: sorted[0]?.venue_id ?? '',
      leafOff: Boolean(sorted[0]?.leaf_off),
      sightings: sorted.map((r) => ({
        id: r.id,
        azimuth: oneDecimal(r.azimuth),
        altitude: oneDecimal(r.altitude),
        at: r.created_at,
      })),
      reporters: new Set(sorted.map((r) => r.net_hash)).size,
      shown: sorted.some((r) => bins.some((bin) => bin?.rows.includes(r))),
      last: sorted.reduce((a, r) => (r.created_at > a ? r.created_at : a), ''),
    })
  }
  return entries.sort(
    (a, b) =>
      b.reporters - a.reporters ||
      (a.last > b.last ? -1 : a.last < b.last ? 1 : 0) ||
      (a.venueId < b.venueId ? -1 : a.venueId > b.venueId ? 1 : 0) ||
      Number(a.leafOff) - Number(b.leafOff),
  )
}

import { z } from 'zod'
import type { LatLon } from '../data/terraces.ts'
import { KINDS, type nextReview } from './review.ts'

/**
 * Visitor venue reports (a venue moved, closed or missing; whether it has a
 * terrace and where, ADR-0009), as the API's
 * `GET /v1/admin/reports` serves them (proxied by the dev server). Pure,
 * except fetchReports.
 */
const common = {
  ids: z.array(z.number().int()).min(1),
  reporters: z.number().int(),
  last: z.string(),
}

export const reportSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('closed'), venueId: z.string() }),
  z.object({
    ...common,
    kind: z.literal('move'),
    venueId: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  z.object({
    ...common,
    kind: z.literal('terrace'),
    venueId: z.string(),
    terrace: z.boolean(),
  }),
  z.object({
    ...common,
    kind: z.literal('pin'),
    venueId: z.string(),
    lat: z.number(),
    lon: z.number(),
  }),
  z.object({
    ...common,
    kind: z.literal('add'),
    name: z.string(),
    venueKind: z.enum(KINDS),
    terrace: z.boolean(),
    lat: z.number(),
    lon: z.number(),
  }),
])
export type VenueReport = z.infer<typeof reportSchema>

export const reportsResponseSchema = z.object({
  reports: z.array(reportSchema),
})

/** Metres between two points; equirectangular, plenty for a city. */
function distanceM(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * 6_371_000
}

/** The venue a report is about, as the admin has it now. */
export type ReportedVenue = { name: string; at: LatLon }

/** Most reporters first; ties keep the API's order. */
export function byReporters(reports: readonly VenueReport[]): VenueReport[] {
  return [...reports].sort((a, b) => b.reporters - a.reporters)
}

/** A report on an existing venue (anything but `add`) whose venue is gone from the data. */
export function isStale(
  report: VenueReport,
  venue: ReportedVenue | undefined,
): boolean {
  return report.kind !== 'add' && venue === undefined
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/**
 * One line: "Closed · Bar Pepe · 3 people", "Moved · Bar Pepe · 42 m",
 * "Terrace: yes · Bar Pepe · 4 people", "Terrace here · Bar Pepe · 12 m from
 * the venue", "New · Bar Nuevo (bar, terrace)".
 */
export function describeReport(
  report: VenueReport,
  venue: ReportedVenue | undefined,
): string {
  switch (report.kind) {
    case 'closed':
      return venue
        ? `Closed · ${venue.name} · ${people(report.reporters)}`
        : `Closed · ${report.venueId} · stale: no longer in the data`
    case 'terrace': {
      const answer = `Terrace: ${report.terrace ? 'yes' : 'no'}`
      return venue
        ? `${answer} · ${venue.name} · ${people(report.reporters)}`
        : `${answer} · ${report.venueId} · stale: no longer in the data`
    }
    case 'pin':
      return venue
        ? `Terrace here · ${venue.name} · ${Math.round(distanceM(venue.at, report))} m from the venue`
        : `Terrace here · ${report.venueId} · stale: no longer in the data`
    case 'move':
      return venue
        ? `Moved · ${venue.name} · ${Math.round(distanceM(venue.at, report))} m`
        : `Moved · ${report.venueId} · stale: no longer in the data`
    case 'add':
      return `New · ${report.name} (${report.venueKind}${report.terrace ? ', terrace' : ''})`
  }
}

/** A change to a venue's review row, as `nextReview` takes it. */
export type ReviewChange = Parameters<typeof nextReview>[2]

/**
 * What accepting a report on an existing venue does to its review row:
 * `closed` → not a venue, `move` → the venue position, `terrace` → terrace or
 * no terrace, `pin` → a terrace at that position. (A `closed` on an added
 * `review:` venue deletes the row instead; the caller handles that.)
 *
 * A `move` on a venue with a terrace moves the terrace instead: the badge the
 * visitor dragged from in the app sits on the terrace, not on the venue.
 */
export function reportChange(
  report: Exclude<VenueReport, { kind: 'add' }>,
  hasTerrace = false,
): ReviewChange {
  switch (report.kind) {
    case 'closed':
      return { kind: 'status', status: 'not_venue' }
    case 'move':
      return {
        kind: hasTerrace ? 'terrace' : 'venue',
        at: { lat: report.lat, lon: report.lon },
      }
    case 'terrace':
      return {
        kind: 'status',
        status: report.terrace ? 'terrace' : 'no_terrace',
      }
    case 'pin':
      return { kind: 'terrace', at: { lat: report.lat, lon: report.lon } }
  }
}

export const REPORTS_API = '/__admin/reports'

export async function fetchReports(): Promise<{
  reports: VenueReport[] | null
  error: string | null
}> {
  try {
    const response = await fetch(REPORTS_API)
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(body)
      return {
        reports: null,
        error: parsed.success ? parsed.data.error : `HTTP ${response.status}`,
      }
    }
    const parsed = reportsResponseSchema.parse(body)
    return { reports: byReporters(parsed.reports), error: null }
  } catch (e) {
    return { reports: null, error: String(e) }
  }
}

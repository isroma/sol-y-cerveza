import { z } from 'zod'

/**
 * Venue review decisions, stored in `pipeline/data/venue_review.csv` (see
 * `pipeline/src/solycerveza/review.py`, which applies them on the next build).
 * Pure: shared by the admin page and its dev-server endpoint.
 */
export const REVIEW_COLUMNS = [
  'venue_id',
  'status',
  'name',
  'kind',
  'venue_lat',
  'venue_lon',
  'terrace_lat',
  'terrace_lon',
  'reviewed',
] as const

export const STATUSES = ['terrace', 'no_terrace', 'not_venue'] as const
export type Status = (typeof STATUSES)[number]

export const KINDS = ['bar', 'pub', 'cafe', 'restaurant', 'biergarten'] as const
export type Kind = (typeof KINDS)[number]

/** Venues no source lists, added in the admin view. */
export const ADDED_PREFIX = 'review:'

const VENUE_ID =
  /^(osm:(node|way)\/\d+|overture:[0-9A-Za-z-]+|junta:[0-9a-f]{12}|review:[a-z0-9]+(-[a-z0-9]+)*)$/

const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

export const reviewSchema = z
  .object({
    venueId: z.string().regex(VENUE_ID),
    status: z.enum(STATUSES).nullable(),
    name: z.string().min(1).nullable(),
    kind: z.enum(KINDS).nullable(),
    venue: latLonSchema.nullable(),
    terrace: latLonSchema.nullable(),
    reviewed: z.iso.date(),
  })
  .refine((r) => r.terrace === null || r.status === 'terrace', {
    message: 'a terrace position needs status terrace',
  })
  .refine(
    (r) =>
      r.venueId.startsWith(ADDED_PREFIX)
        ? r.name !== null && r.kind !== null && r.venue !== null
        : r.name === null && r.kind === null,
    { message: 'name, kind and position go with added (review:) venues only' },
  )
  .refine(
    (r) => !(r.venueId.startsWith(ADDED_PREFIX) && r.status === 'not_venue'),
    { message: 'delete an added venue instead of marking it not_venue' },
  )
  .refine((r) => r.status !== null || r.venue !== null, {
    message: 'a row needs a status or a venue position',
  })

export type Review = z.infer<typeof reviewSchema>
type LatLon = z.infer<typeof latLonSchema>

function cell(value: number | string | null): string {
  if (value === null) return ''
  if (typeof value === 'number') return String(Number(value.toFixed(6)))
  return value
}

function number(value: string | undefined): number | null {
  return value ? Number(value) : null
}

function pair(lat: string | undefined, lon: string | undefined) {
  const a = number(lat)
  const b = number(lon)
  return a === null || b === null ? null : { lat: a, lon: b }
}

export function parseReviewCsv(text: string): Review[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line !== '')
  if (header !== REVIEW_COLUMNS.join(',')) {
    throw new Error(
      `venue_review.csv: header must be ${REVIEW_COLUMNS.join(',')}`,
    )
  }
  return lines.map((line, index) => {
    if (line.includes('"')) {
      throw new Error(`venue_review.csv:${index + 2}: quotes are not supported`)
    }
    const [venueId, status, name, kind, vLat, vLon, tLat, tLon, reviewed] =
      line.split(',')
    const parsed = reviewSchema.safeParse({
      venueId,
      status: status || null,
      name: name || null,
      kind: kind || null,
      venue: pair(vLat, vLon),
      terrace: pair(tLat, tLon),
      reviewed,
    })
    if (!parsed.success) {
      throw new Error(`venue_review.csv:${index + 2}: ${parsed.error.message}`)
    }
    return parsed.data
  })
}

/** One row per venue, sorted by venue id so diffs stay small. */
export function formatReviewCsv(reviews: readonly Review[]): string {
  const rows = [...reviews]
    .sort((a, b) =>
      a.venueId < b.venueId ? -1 : a.venueId > b.venueId ? 1 : 0,
    )
    .map((r) =>
      [
        r.venueId,
        r.status,
        r.name,
        r.kind,
        r.venue?.lat ?? null,
        r.venue?.lon ?? null,
        r.terrace?.lat ?? null,
        r.terrace?.lon ?? null,
        r.reviewed,
      ]
        .map(cell)
        .join(','),
    )
  return [REVIEW_COLUMNS.join(','), ...rows].join('\n') + '\n'
}

export function upsertReview(
  reviews: readonly Review[],
  review: Review,
): Review[] {
  return [...reviews.filter((r) => r.venueId !== review.venueId), review]
}

export function removeReview(
  reviews: readonly Review[],
  venueId: string,
): Review[] {
  return reviews.filter((r) => r.venueId !== venueId)
}

/** The row after a change: keeps what the change does not touch. */
export function nextReview(
  current: Review | undefined,
  venueId: string,
  change:
    | { kind: 'status'; status: Status }
    | { kind: 'terrace'; at: LatLon }
    | { kind: 'venue'; at: LatLon },
  today: string,
): Review {
  const base: Review = current ?? {
    venueId,
    status: null,
    name: null,
    kind: null,
    venue: null,
    terrace: null,
    reviewed: today,
  }
  switch (change.kind) {
    case 'status':
      return {
        ...base,
        status: change.status,
        terrace: change.status === 'terrace' ? base.terrace : null,
        reviewed: today,
      }
    case 'terrace':
      return { ...base, status: 'terrace', terrace: change.at, reviewed: today }
    case 'venue':
      return { ...base, venue: change.at, reviewed: today }
  }
}

/** A `review:` id for a new venue, unique among `taken`. */
export function addedId(name: string, taken: ReadonlySet<string>): string {
  const slug =
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'venue'
  let id = `${ADDED_PREFIX}${slug}`
  for (let n = 2; taken.has(id); n++) id = `${ADDED_PREFIX}${slug}-${n}`
  return id
}

/** CSV cells are not quoted, so names lose commas, quotes and line breaks. */
export function cleanName(name: string): string {
  return name
    .replace(/[,"\n\r]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

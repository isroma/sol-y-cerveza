import type { LatLon, Terrace } from '../data/terraces.ts'
import { distanceMetres, latitudeGapMetres } from '../data/geo.ts'
import {
  isStrong,
  JUNK_LABELS,
  junkSignalsAll,
  STRONG,
  type JunkSignal,
} from './junk.ts'
import type { Proposal } from './proposals.ts'
import type { Review } from './review.ts'

/**
 * How much reviewing a venue is worth, for the admin's review queue: the
 * venues visitors look at first. A sum of five parts, each 0–1 times a weight:
 *
 *   3 × centre    1 at the centre, falling linearly to 0 at CENTRE_M.
 *   3 × cluster   confirmed terraces within CLUSTER_M (up to CLUSTER_FULL):
 *                 squares and streets people go to. Confirmed = reviewed as
 *                 terrace, or a terrace in the data from OSM or curated rows.
 *   2 × source    OSM or added in the admin 1, Junta register 0.6, Overture 0.3.
 *   1 × kind      bar, café, restaurant, beer garden 1; pub 0.5 (night-time).
 *   2 × proposal  the confidence of the venue's best open machine proposal.
 *
 * Minus 3 when the venue looks like it is not a venue at all (a strong signal
 * from junk.ts): those are for the batch dismissal, not the queue.
 *
 * The top reason is the part that adds most (or the junk signal).
 */
export const WEIGHTS = {
  centre: 3,
  cluster: 3,
  source: 2,
  kind: 1,
  proposal: 2,
  junk: -3,
} as const

export const CENTRE_M = 2500
export const CLUSTER_M = 120
export const CLUSTER_FULL = 4

export type Part = keyof typeof WEIGHTS

const POSITIVE: readonly Part[] = [
  'centre',
  'cluster',
  'source',
  'kind',
  'proposal',
]

export type Scored = {
  venue: Terrace
  score: number
  parts: Record<Part, number>
  reason: string
}

const SOURCE_VALUE: Record<string, number> = {
  osm: 1,
  curated: 1,
  review: 1,
  junta: 0.6,
  overture: 0.3,
}

const SOURCE_NAMES: Record<string, string> = {
  osm: 'OSM venue',
  curated: 'Curated venue',
  review: 'Added in the admin',
  junta: 'Junta register',
  overture: 'Overture',
}

const KIND_VALUE: Record<Terrace['kind'], number> = {
  bar: 1,
  cafe: 1,
  restaurant: 1,
  biergarten: 1,
  pub: 0.5,
}

/** Reviewed as terrace, or a data terrace from OSM/curated not reviewed away. */
export function isConfirmedTerrace(
  venue: Terrace,
  review: Review | undefined,
): boolean {
  if (review?.status) return review.status === 'terrace'
  return (
    venue.terrace !== null &&
    (venue.sources.includes('osm') || venue.sources.includes('curated'))
  )
}

function positionOf(venue: Terrace, review: Review | undefined): LatLon {
  return review?.venue ?? venue.venue
}

function sourceValue(venue: Terrace): { value: number; name: string } {
  let best = { value: 0, name: 'Unknown source' }
  for (const s of venue.sources) {
    const value = SOURCE_VALUE[s] ?? 0
    if (value > best.value) best = { value, name: SOURCE_NAMES[s] ?? s }
  }
  return best
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * Scores every venue in `venues` (reviewed or not). `junk` is
 * `junkSignalsAll` of the same venues, when the caller has it already.
 */
export function scoreVenues(
  venues: readonly Terrace[],
  reviews: ReadonlyMap<string, Review>,
  proposals: ReadonlyMap<string, readonly Proposal[]>,
  centre: LatLon,
  junk: ReadonlyMap<string, readonly JunkSignal[]> = junkSignalsAll(
    venues,
    reviews,
    centre,
  ),
): Scored[] {
  const confirmed = venues
    .filter((v) => isConfirmedTerrace(v, reviews.get(v.id)))
    .map((v) => ({ id: v.id, at: positionOf(v, reviews.get(v.id)) }))
  return venues.map((venue) => {
    const review = reviews.get(venue.id)
    const at = positionOf(venue, review)
    const fromCentre = distanceMetres(at, centre)
    // The latitude test first skips most pairs: this runs on every review.
    const near = confirmed.filter(
      (c) =>
        c.id !== venue.id &&
        latitudeGapMetres(c.at, at) <= CLUSTER_M &&
        distanceMetres(c.at, at) <= CLUSTER_M,
    ).length
    const source = sourceValue(venue)
    const best = proposals.get(venue.id)?.[0]
    const signals = junk.get(venue.id) ?? []
    const looksJunk = isStrong(signals)
    const parts: Record<Part, number> = {
      centre: WEIGHTS.centre * Math.max(0, 1 - fromCentre / CENTRE_M),
      cluster: WEIGHTS.cluster * (Math.min(near, CLUSTER_FULL) / CLUSTER_FULL),
      source: WEIGHTS.source * source.value,
      kind: WEIGHTS.kind * KIND_VALUE[venue.kind],
      proposal: WEIGHTS.proposal * (best?.confidence ?? 0),
      junk: looksJunk ? WEIGHTS.junk : 0,
    }
    const texts: Record<Part, string> = {
      centre: `${Math.round(fromCentre / 10) * 10} m from the centre`,
      cluster: `${plural(near, 'confirmed terrace', 'confirmed terraces')} within ${CLUSTER_M} m`,
      source: source.name,
      kind: venue.kind,
      proposal: `Machine proposal (${Math.round((best?.confidence ?? 0) * 100)} %)`,
      junk: `Looks like not a venue: ${signals
        .filter((s) => STRONG.has(s))
        .map((s) => JUNK_LABELS[s])
        .join(', ')}`,
    }
    const top = looksJunk
      ? 'junk'
      : POSITIVE.reduce((a, b) => (parts[b] > parts[a] ? b : a))
    const score = Object.values(parts).reduce((a, b) => a + b, 0)
    return {
      venue,
      score: Math.round(score * 100) / 100,
      parts,
      reason: texts[top],
    }
  })
}

/**
 * The review queue: venues without a decision, best score first (ties by
 * name), with skipped ones after the rest in the order they were skipped.
 */
export function queueOrder(
  scored: readonly Scored[],
  reviews: ReadonlyMap<string, Review>,
  skipped: readonly string[],
): Scored[] {
  const open = scored.filter((s) => !reviews.get(s.venue.id)?.status)
  const later = new Map(skipped.map((id, i) => [id, i]))
  return open.sort((a, b) => {
    const la = later.get(a.venue.id)
    const lb = later.get(b.venue.id)
    if (la !== undefined || lb !== undefined) return (la ?? -1) - (lb ?? -1)
    return b.score - a.score || a.venue.name.localeCompare(b.venue.name, 'es')
  })
}

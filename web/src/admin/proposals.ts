import { z } from 'zod'
import { parseCsvRows } from './priceCandidates.ts'
import type { Review, Status } from './review.ts'

/**
 * Machine proposals for venues, waiting for the owner's one-tap decision
 * (`pipeline/data/venue_proposals.csv`, written by a separate tool; the file
 * may not exist). Pure: shared by the admin page and its dev-server endpoint.
 *
 * One row per proposal. `kind`:
 * - `terrace`: the venue has a terrace; lat/lon is the proposed terrace pin.
 * - `no_terrace`: the venue has no terrace.
 * - `position`: lat/lon is the corrected venue position.
 * - `not_venue`: closed, or not a bar or restaurant.
 */
export const PROPOSAL_COLUMNS = [
  'venue_id',
  'kind',
  'lat',
  'lon',
  'confidence',
  'evidence',
  'source',
  'generated',
] as const

export const PROPOSAL_KINDS = [
  'terrace',
  'no_terrace',
  'position',
  'not_venue',
] as const
export type ProposalKind = (typeof PROPOSAL_KINDS)[number]

const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

export const proposalSchema = z
  .object({
    venueId: z.string().min(1),
    kind: z.enum(PROPOSAL_KINDS),
    at: latLonSchema.nullable(),
    confidence: z.number().min(0).max(1),
    evidence: z.string().min(1).max(400),
    source: z.string().min(1),
    generated: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  })
  .refine(
    (p) => (p.kind === 'terrace' || p.kind === 'position') === (p.at !== null),
    { message: 'terrace and position need lat/lon; the other kinds none' },
  )

export type Proposal = z.infer<typeof proposalSchema>

/** What `GET /__admin/proposals` answers. */
export const proposalsResponseSchema = z.object({
  proposals: z.array(proposalSchema),
  /** Keys of proposals the owner ignored. */
  ignored: z.array(z.string()),
  /** Rows of venue_proposals.csv that did not validate, as messages. */
  errors: z.array(z.string()),
})
export type ProposalsResponse = z.infer<typeof proposalsResponseSchema>

/** What `POST /__admin/proposals` takes: ignore one proposal. */
export const ignoreSchema = z.object({ key: z.string().min(1) })

export function proposalKey(p: Proposal): string {
  return [p.venueId, p.kind, p.at?.lat ?? '', p.at?.lon ?? ''].join('|')
}

function number(value: string | undefined): number | null {
  return value === undefined || value.trim() === '' ? null : Number(value)
}

/**
 * Valid rows, and a message for each row that is not. A bad row never hides
 * the others: the file comes from another tool.
 */
export function parseProposalsCsv(text: string): {
  proposals: Proposal[]
  errors: string[]
} {
  const [header, ...rows] = parseCsvRows(text)
  if (header === undefined) return { proposals: [], errors: [] }
  if (header.join(',') !== PROPOSAL_COLUMNS.join(','))
    return {
      proposals: [],
      errors: [
        `venue_proposals.csv: header must be ${PROPOSAL_COLUMNS.join(',')}`,
      ],
    }
  const proposals: Proposal[] = []
  const errors: string[] = []
  rows.forEach((cells, index) => {
    const line = `venue_proposals.csv:${index + 2}`
    if (cells.length !== PROPOSAL_COLUMNS.length) {
      errors.push(`${line}: wrong cell count`)
      return
    }
    const [venueId, kind, lat, lon, confidence, evidence, source, generated] =
      cells
    const a = number(lat)
    const b = number(lon)
    const parsed = proposalSchema.safeParse({
      venueId,
      kind,
      at: a === null || b === null ? null : { lat: a, lon: b },
      confidence: Number(confidence),
      evidence: evidence?.trim(),
      source,
      generated,
    })
    if (parsed.success) proposals.push(parsed.data)
    else errors.push(`${line}: ${z.prettifyError(parsed.error)}`)
  })
  return { proposals, errors }
}

/** `pipeline/.cache/venue_proposals_ignored.csv`: one key per line. */
export function parseIgnored(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== 'key')
}

export function formatIgnored(keys: readonly string[]): string {
  return ['key', ...[...new Set(keys)].sort()].join('\n') + '\n'
}

/** Whether the review already settles what the proposal is about. */
function settled(p: Proposal, review: Review | undefined): boolean {
  if (review?.status === 'not_venue') return true
  if (p.kind === 'position') return review?.venue != null
  return review?.status != null
}

/**
 * Proposals still waiting for a decision, highest confidence first: not
 * ignored, and not settled by a review.
 */
export function openProposals(
  proposals: readonly Proposal[],
  reviews: ReadonlyMap<string, Review>,
  ignored: ReadonlySet<string>,
): Map<string, Proposal[]> {
  const out = new Map<string, Proposal[]>()
  for (const p of proposals) {
    if (ignored.has(proposalKey(p))) continue
    if (settled(p, reviews.get(p.venueId))) continue
    out.set(p.venueId, [...(out.get(p.venueId) ?? []), p])
  }
  for (const list of out.values())
    list.sort((a, b) => b.confidence - a.confidence)
  return out
}

/** The review change that accepting a proposal makes (see `nextReview`). */
export function acceptChange(
  p: Proposal,
):
  | { kind: 'status'; status: Status }
  | { kind: 'terrace'; at: { lat: number; lon: number } }
  | { kind: 'venue'; at: { lat: number; lon: number } } {
  if (p.kind === 'terrace' && p.at) return { kind: 'terrace', at: p.at }
  if (p.kind === 'position' && p.at) return { kind: 'venue', at: p.at }
  if (p.kind === 'not_venue') return { kind: 'status', status: 'not_venue' }
  return {
    kind: 'status',
    status: p.kind === 'terrace' ? 'terrace' : 'no_terrace',
  }
}

export const PROPOSAL_LABELS: Record<ProposalKind, string> = {
  terrace: 'Terrace here',
  no_terrace: 'No terrace',
  position: 'Venue is here',
  not_venue: 'Not a venue',
}

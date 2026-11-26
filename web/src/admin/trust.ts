import { z } from 'zod'

/**
 * How far to trust an Overture-only venue before review (issue #493), from
 * `pipeline/.cache/venue_trust.json`, written by `python -m solycerveza.trust`
 * (the file may not exist). Dev only: the build never reads it and visitors
 * never see it. Pure: shared by the admin page and its dev-server endpoint.
 *
 * - `strong`: Overture confidence >= 0.9, and both Meta and BrightQuery list
 *   it or a Junta register row confirms it.
 * - `weak`: every other Overture-only venue. The queue shows these first.
 * - `positionDoubtful`: BrightQuery is its only position source.
 *
 * Venues from OSM, curated rows, `review:` and the Junta have no row.
 */
export const trustSchema = z.object({
  venueId: z.string().min(1),
  tier: z.enum(['strong', 'weak']),
  positionDoubtful: z.boolean(),
  confidence: z.number().min(0).max(1),
  datasets: z.array(z.string()),
  junta: z.boolean(),
})

export type Trust = z.infer<typeof trustSchema>

/** The file `python -m solycerveza.trust` writes (snake_case keys). */
export const trustFileSchema = z.object({
  venues: z.array(
    z
      .object({
        venue_id: z.string().min(1),
        tier: z.enum(['strong', 'weak']),
        position_doubtful: z.boolean(),
        confidence: z.number().min(0).max(1),
        datasets: z.array(z.string()),
        junta: z.boolean(),
      })
      .transform((r): Trust => ({
        venueId: r.venue_id,
        tier: r.tier,
        positionDoubtful: r.position_doubtful,
        confidence: r.confidence,
        datasets: r.datasets,
        junta: r.junta,
      })),
  ),
})

/** What `GET /__admin/trust` answers. */
export const trustResponseSchema = z.object({
  venues: z.array(trustSchema),
  /** True when the file does not exist yet. */
  missing: z.boolean(),
})

export type TrustResponse = z.infer<typeof trustResponseSchema>

/** The endpoint's answer for the file's text, or null when it is missing. */
export function trustResponse(text: string | null): TrustResponse {
  if (text === null) return { venues: [], missing: true }
  const { venues } = trustFileSchema.parse(JSON.parse(text))
  return { venues, missing: false }
}

export function trustById(rows: readonly Trust[]): Map<string, Trust> {
  return new Map(rows.map((t) => [t.venueId, t]))
}

/** The short hint the queue shows before its reason, or '' for none. */
export function trustHint(trust: Trust | undefined): string {
  if (!trust) return ''
  const parts = [
    ...(trust.tier === 'weak' ? ['weak source'] : []),
    ...(trust.positionDoubtful ? ['position doubtful'] : []),
  ]
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The venue panel's line: the tier and what it is based on. */
export function trustDetails(trust: Trust): string {
  const sources = trust.datasets.length ? trust.datasets.join(' + ') : 'none'
  return [
    `${trust.tier === 'weak' ? 'Weak' : 'Strong'} source`,
    `Overture confidence ${trust.confidence.toFixed(2)}`,
    `datasets ${sources}`,
    trust.junta ? 'Junta register confirms it' : 'no Junta register match',
    ...(trust.positionDoubtful ? ['position doubtful (BrightQuery only)'] : []),
  ].join(' · ')
}

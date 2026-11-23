import { z } from 'zod'
import { BRANDS, ITEMS } from '../data/prices.ts'
import type { VenuePrice } from './pricesCsv.ts'

/**
 * Beer prices read on venues' own websites, waiting for the owner's decision
 * (`pipeline/data/price_candidates.csv`, written by
 * `python -m solycerveza.price_candidates`; see ADR-0006). Pure: shared by
 * the admin page and its dev-server endpoint.
 */
export const CANDIDATE_COLUMNS = [
  'venue_id',
  'item',
  'brand',
  'cents',
  'source_url',
  'snippet',
  'fetched',
  'status',
] as const

export const CANDIDATE_STATUSES = ['pending', 'accepted', 'dismissed'] as const

export const candidateSchema = z
  .object({
    venueId: z.string().min(1),
    item: z.enum(ITEMS),
    brand: z.enum(BRANDS).nullable(),
    cents: z.number().int().min(50).max(1500),
    sourceUrl: z.url({ protocol: /^https?$/ }),
    snippet: z.string().min(1).max(160),
    fetched: z.iso.date(),
    status: z.enum(CANDIDATE_STATUSES),
  })
  .refine((c) => (c.item === 'tercio') === (c.brand !== null), {
    message: 'a tercio needs a brand and a caña has none',
  })

export type Candidate = z.infer<typeof candidateSchema>
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number]

/** A menu published as a PDF or an image (`.cache/menu_leads.csv`). */
export const leadSchema = z.object({
  venueId: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
})
export type Lead = z.infer<typeof leadSchema>

/** What `GET /__admin/price-candidates` answers. */
export const candidatesResponseSchema = z.object({
  candidates: z.array(candidateSchema),
  leads: z.array(leadSchema),
})
export type CandidatesResponse = z.infer<typeof candidatesResponseSchema>

/** What `POST /__admin/price-candidates` takes. */
export const decisionSchema = z.object({
  key: z.string().min(1),
  status: z.enum(['accepted', 'dismissed']),
})
export type Decision = z.infer<typeof decisionSchema>

/** Same venue, item, brand, price and page: the pipeline's identity too. */
export function candidateKey(c: Candidate): string {
  return [c.venueId, c.item, c.brand ?? '', String(c.cents), c.sourceUrl].join(
    '|',
  )
}

/** The price to save when the owner accepts a candidate. */
export function toPrice(c: Candidate): VenuePrice {
  return {
    venueId: c.venueId,
    item: c.item,
    brand: c.brand,
    cents: c.cents,
    seen: c.fetched,
  }
}

/** RFC 4180 rows (as Python's csv module writes them): quotes, "" escapes. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (char === '"') quoted = false
      else cell += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(cell)
      cell = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += char
  }
  if (quoted) throw new Error('unterminated quoted cell')
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  return rows.filter((r) => !(r.length === 1 && r[0] === ''))
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

export function parseCandidatesCsv(text: string): Candidate[] {
  const [header, ...rows] = parseCsvRows(text)
  if (header?.join(',') !== CANDIDATE_COLUMNS.join(',')) {
    throw new Error(
      `price_candidates.csv: header must be ${CANDIDATE_COLUMNS.join(',')}`,
    )
  }
  return rows.map((cells, index) => {
    if (cells.length !== CANDIDATE_COLUMNS.length)
      throw new Error(`price_candidates.csv:${index + 2}: wrong cell count`)
    const [venueId, item, brand, cents, sourceUrl, snippet, fetched, status] =
      cells
    const parsed = candidateSchema.safeParse({
      venueId,
      item,
      brand: brand || null,
      cents: Number(cents),
      sourceUrl,
      snippet,
      fetched,
      status,
    })
    if (!parsed.success)
      throw new Error(
        `price_candidates.csv:${index + 2}: ${parsed.error.message}`,
      )
    return parsed.data
  })
}

function sortKey(c: Candidate): string[] {
  return [
    c.venueId,
    c.item,
    c.brand ?? '',
    String(c.cents),
    c.sourceUrl,
    c.snippet,
  ]
}

function compareKeys(a: string[], b: string[]): number {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? ''
    const y = b[i] ?? ''
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}

/**
 * Sorted the way the pipeline writes the file (cents as numbers), so a
 * decision changes one line only.
 */
export function formatCandidatesCsv(candidates: readonly Candidate[]): string {
  const rows = [...candidates]
    .sort((a, b) => {
      const byText = compareKeys(sortKey(a).slice(0, 3), sortKey(b).slice(0, 3))
      if (byText !== 0) return byText
      if (a.cents !== b.cents) return a.cents - b.cents
      return compareKeys(sortKey(a).slice(4), sortKey(b).slice(4))
    })
    .map((c) =>
      [
        c.venueId,
        c.item,
        c.brand ?? '',
        String(c.cents),
        c.sourceUrl,
        c.snippet,
        c.fetched,
        c.status,
      ]
        .map(csvCell)
        .join(','),
    )
  return [CANDIDATE_COLUMNS.join(','), ...rows].join('\n') + '\n'
}

/** Records the owner's decision on the candidate with `key`. */
export function decide(
  candidates: readonly Candidate[],
  decision: Decision,
): Candidate[] {
  if (!candidates.some((c) => candidateKey(c) === decision.key))
    throw new Error(`no candidate ${decision.key}`)
  return candidates.map((c) =>
    candidateKey(c) === decision.key ? { ...c, status: decision.status } : c,
  )
}

/** Leads from `menu_leads.csv` (venue_id,url). */
export function parseLeadsCsv(text: string): Lead[] {
  const [header, ...rows] = parseCsvRows(text)
  if (header?.join(',') !== 'venue_id,url')
    throw new Error('menu_leads.csv: header must be venue_id,url')
  return rows.map(([venueId, url]) => leadSchema.parse({ venueId, url }))
}

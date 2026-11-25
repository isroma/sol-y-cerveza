import { z } from 'zod'
import { BRAND_NAMES, BRANDS, formatCents, ITEMS } from '../data/prices.ts'
import type { LatLon } from '../data/terraces.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { JUNK_LABELS, type JunkItem } from './junk.ts'
import {
  candidateKey,
  candidatesResponseSchema,
  type Candidate,
  type CandidatesResponse,
  type Lead,
} from './priceCandidates.ts'
import {
  describeReport,
  fetchReports,
  type ReportedVenue,
  type VenueReport,
} from './reports.ts'
import {
  describeSunReport,
  sunResponseSchema,
  type SunReport,
} from './sunReports.ts'

/**
 * The Inbox: everything from outside that waits for a yes or no, as one list.
 * Visitor reports, sun reports and price suggestions (the API), prices read on venues'
 * websites (price_candidates.csv) and likely non-venues (junk.ts). Pure,
 * except the fetchers.
 */

const suggestionSchema = z.object({
  venue_id: z.string(),
  item: z.enum(ITEMS),
  brand: z.string(),
  cents: z.number().int(),
  voters: z.number().int(),
  last: z.string(),
})
export type SuggestionGroup = z.infer<typeof suggestionSchema>

export type InboxKind = 'report' | 'sun' | 'suggestion' | 'price' | 'junk'

export type InboxItem = { key: string; kind: InboxKind } & (
  | { kind: 'report'; report: VenueReport }
  | { kind: 'sun'; sun: SunReport }
  | { kind: 'suggestion'; group: SuggestionGroup }
  | { kind: 'price'; candidate: Candidate }
  | { kind: 'junk'; junk: JunkItem }
)

export const KIND_LABELS: Record<InboxKind, string> = {
  report: 'Report',
  sun: 'Sun',
  suggestion: 'Price',
  price: 'Website',
  junk: 'Not venue?',
}

/** The venue an item is about, or null for a report of a new venue. */
export function itemVenueId(item: InboxItem): string | null {
  switch (item.kind) {
    case 'report':
      return item.report.kind === 'add' ? null : item.report.venueId
    case 'sun':
      return item.sun.venueId
    case 'suggestion':
      return item.group.venue_id
    case 'price':
      return item.candidate.venueId
    case 'junk':
      return item.junk.venue.id
  }
}

/** A point to show on the map: where a report proposes the venue or terrace. */
export function itemPoint(item: InboxItem): LatLon | null {
  if (item.kind !== 'report' || !('lat' in item.report)) return null
  return { lat: item.report.lat, lon: item.report.lon }
}

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

function priceLabel(item: string, brand: string | null): string {
  if (item === 'cana' || !brand) return 'Caña'
  const known = BRANDS.find((b) => b === brand)
  return `Tercio ${known ? BRAND_NAMES[known] : brand}`
}

/** The row's title and the one line under it. */
export function describeItem(
  item: InboxItem,
  venueOf: (id: string) => ReportedVenue | undefined,
): { title: string; detail: string } {
  const venueId = itemVenueId(item)
  const name = venueId ? (venueOf(venueId)?.name ?? venueId) : ''
  switch (item.kind) {
    case 'report': {
      if (item.report.kind === 'add')
        return {
          title: item.report.name,
          detail: describeReport(item.report, undefined),
        }
      // describeReport repeats the name: keep what it says about it.
      const parts = describeReport(
        item.report,
        venueOf(item.report.venueId),
      ).split(' · ')
      return { title: name, detail: [parts[0], ...parts.slice(2)].join(' · ') }
    }
    case 'sun':
      return {
        title: name,
        detail: describeSunReport(
          item.sun,
          venueOf(item.sun.venueId) !== undefined,
        ),
      }
    case 'suggestion':
      return {
        title: name,
        detail: `${priceLabel(item.group.item, item.group.brand || null)} ${formatCents(item.group.cents)} · ${people(item.group.voters)}`,
      }
    case 'price':
      return {
        title: name,
        detail: `${priceLabel(item.candidate.item, item.candidate.brand)} ${formatCents(item.candidate.cents)} · ${new URL(item.candidate.sourceUrl).host.replace(/^www\./, '')}`,
      }
    case 'junk':
      return {
        title: name,
        detail: item.junk.signals.map((s) => JUNK_LABELS[s]).join(' · '),
      }
  }
}

/**
 * One list: reports, then sun reports, suggestions, website prices and likely
 * non-venues.
 */
export function inboxItems(sources: {
  reports: readonly VenueReport[]
  sun: readonly SunReport[]
  suggestions: readonly SuggestionGroup[]
  candidates: readonly Candidate[]
  junk: readonly JunkItem[]
  /** Kept for now: likely non-venues the owner said are venues. */
  kept: ReadonlySet<string>
}): InboxItem[] {
  return [
    ...sources.reports.map((report): InboxItem => ({
      kind: 'report',
      key: `report:${report.ids.join(',')}`,
      report,
    })),
    ...sources.sun.map((sun): InboxItem => ({
      kind: 'sun',
      key: `sun:${sun.ids.join(',')}`,
      sun,
    })),
    ...sources.suggestions.map((group): InboxItem => ({
      kind: 'suggestion',
      key: `suggestion:${group.venue_id}|${group.item}|${group.brand}|${group.cents}`,
      group,
    })),
    ...sources.candidates
      .filter((c) => c.status === 'pending')
      .map((candidate): InboxItem => ({
        kind: 'price',
        key: `price:${candidateKey(candidate)}`,
        candidate,
      })),
    ...sources.junk
      .filter((j) => !sources.kept.has(j.venue.id))
      .map((junk): InboxItem => ({
        kind: 'junk',
        key: `junk:${junk.venue.id}`,
        junk,
      })),
  ]
}

/**
 * After answering or skipping `key`, the item to show next: the one after it
 * in the list as it was, else the one before, else none.
 */
export function nextItem(
  items: readonly InboxItem[],
  key: string,
): InboxItem | null {
  const index = items.findIndex((i) => i.key === key)
  if (index === -1) return items[0] ?? null
  return items[index + 1] ?? items[index - 1] ?? null
}

type Fetched<T> = { data: T | null; error: string | null }

async function getJson<T>(
  url: string,
  parse: (body: unknown) => T,
): Promise<Fetched<T>> {
  try {
    const response = await fetch(url)
    const body: unknown = await response.json()
    if (!response.ok) {
      const parsed = z.object({ error: z.string() }).safeParse(body)
      return {
        data: null,
        error: parsed.success ? parsed.data.error : `HTTP ${response.status}`,
      }
    }
    return { data: parse(body), error: null }
  } catch (e) {
    return { data: null, error: String(e) }
  }
}

export function fetchSuggestions(): Promise<Fetched<SuggestionGroup[]>> {
  return getJson(
    ADMIN_ENDPOINTS.suggestions,
    (body) =>
      z.object({ suggestions: z.array(suggestionSchema) }).parse(body)
        .suggestions,
  )
}

export function fetchSun(): Promise<Fetched<SunReport[]>> {
  return getJson(
    ADMIN_ENDPOINTS.sun,
    (body) => sunResponseSchema.parse(body).reports,
  )
}

export function fetchCandidates(): Promise<Fetched<CandidatesResponse>> {
  return getJson(ADMIN_ENDPOINTS.priceCandidates, (body) =>
    candidatesResponseSchema.parse(body),
  )
}

export async function fetchInbox(): Promise<{
  reports: VenueReport[]
  sun: SunReport[]
  suggestions: SuggestionGroup[]
  candidates: Candidate[]
  leads: Lead[]
  /** Why a source couldn't load, per source. */
  errors: string[]
}> {
  const [reports, sun, suggestions, candidates] = await Promise.all([
    fetchReports(),
    fetchSun(),
    fetchSuggestions(),
    fetchCandidates(),
  ])
  return {
    reports: reports.reports ?? [],
    sun: sun.data ?? [],
    suggestions: suggestions.data ?? [],
    candidates: candidates.data?.candidates ?? [],
    leads: candidates.data?.leads ?? [],
    errors: [
      ...(reports.error ? [`Reports: ${reports.error}`] : []),
      ...(sun.error ? [`Sun reports: ${sun.error}`] : []),
      ...(suggestions.error ? [`Suggestions: ${suggestions.error}`] : []),
      ...(candidates.error ? [`Website prices: ${candidates.error}`] : []),
    ],
  }
}

/** POSTs a decision to an admin endpoint; null, or why it failed. */
export async function postDecision(
  url: string,
  body: unknown,
): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return response.ok ? null : `HTTP ${response.status}`
  } catch (e) {
    return String(e)
  }
}

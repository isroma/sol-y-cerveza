import { BRANDS } from '../data/prices.ts'
import type { Terrace } from '../data/terraces.ts'
import { priceKey, type VenuePrice } from './pricesCsv.ts'
import { reportChange, type VenueReport } from './reports.ts'
import {
  ADDED_PREFIX,
  addedId,
  cleanName,
  nextReview,
  type Review,
} from './review.ts'
import type { SuggestionGroup } from './inbox.ts'
import { today } from './today.ts'

type Options = {
  venues: readonly Terrace[]
  reviews: ReadonlyMap<string, Review>
  save: (venueId: string, next: Review | null) => Promise<boolean>
  savePrice: (key: string, next: VenuePrice | null) => Promise<void>
  /** After a report is applied and saved. */
  onReportSaved: () => void
}

/**
 * Accepting what visitors sent through the API: a venue report becomes a
 * review row (reportChange), a price suggestion a row of venue_prices.csv.
 */
export function useReportActions({
  venues,
  reviews,
  save,
  savePrice,
  onReportSaved,
}: Options) {
  const acceptSuggestion = async (g: SuggestionGroup) => {
    const brand = BRANDS.find((b) => b === g.brand) ?? null
    const price: VenuePrice = {
      venueId: g.venue_id,
      item: g.item,
      brand,
      cents: g.cents,
      seen: g.last.slice(0, 10),
    }
    await savePrice(priceKey(price), price)
  }

  /** Applies a visitor report through the review rows; true once saved. */
  const acceptReport = async (r: VenueReport): Promise<boolean> => {
    let saved: boolean
    if (r.kind === 'add') {
      const name = cleanName(r.name)
      const venueId = addedId(name, new Set(venues.map((v) => v.id)))
      saved = await save(venueId, {
        venueId,
        status: r.terrace ? 'terrace' : null,
        name,
        kind: r.venueKind,
        venue: { lat: r.lat, lon: r.lon },
        terrace: null,
        reviewed: today(),
        looksRight: false,
      })
    } else if (r.kind === 'closed' && r.venueId.startsWith(ADDED_PREFIX)) {
      saved = await save(r.venueId, null)
    } else {
      const current = reviews.get(r.venueId)
      const data = venues.find((v) => v.id === r.venueId)?.terrace
      // Same rule as the selected venue's terrace pin in Admin.tsx.
      const hasTerrace = current?.status
        ? current.status === 'terrace' && !!(current.terrace ?? data)
        : !!data
      saved = await save(
        r.venueId,
        nextReview(current, r.venueId, reportChange(r, hasTerrace), today()),
      )
    }
    if (saved) onReportSaved()
    return saved
  }

  return { acceptReport, acceptSuggestion }
}

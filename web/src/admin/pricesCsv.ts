import { z } from 'zod'
import { BRANDS, ITEMS } from '../data/prices.ts'

/**
 * Beer prices entered in the admin, stored in `pipeline/data/venue_prices.csv`
 * (see `pipeline/src/solycerveza/prices.py`). Pure: shared by the admin page
 * and its dev-server endpoint.
 */
export const PRICE_COLUMNS = [
  'venue_id',
  'item',
  'brand',
  'cents',
  'seen',
] as const

export const venuePriceSchema = z
  .object({
    venueId: z.string().min(1),
    item: z.enum(ITEMS),
    brand: z.enum(BRANDS).nullable(),
    cents: z.number().int().min(50).max(1500),
    seen: z.iso.date(),
  })
  .refine((p) => (p.item === 'tercio') === (p.brand !== null), {
    message: 'a tercio needs a brand and a caña has none',
  })

export type VenuePrice = z.infer<typeof venuePriceSchema>

/** One row per venue, item and brand. */
export function priceKey(p: Pick<VenuePrice, 'venueId' | 'item' | 'brand'>) {
  return `${p.venueId}|${p.item}|${p.brand ?? ''}`
}

export function parsePricesCsv(text: string): VenuePrice[] {
  const [header, ...lines] = text.split(/\r?\n/).filter((line) => line !== '')
  if (header !== PRICE_COLUMNS.join(',')) {
    throw new Error(
      `venue_prices.csv: header must be ${PRICE_COLUMNS.join(',')}`,
    )
  }
  return lines.map((line, index) => {
    const [venueId, item, brand, cents, seen] = line.split(',')
    const parsed = venuePriceSchema.safeParse({
      venueId,
      item,
      brand: brand || null,
      cents: Number(cents),
      seen,
    })
    if (!parsed.success) {
      throw new Error(`venue_prices.csv:${index + 2}: ${parsed.error.message}`)
    }
    return parsed.data
  })
}

/** Sorted by venue, item and brand, so diffs stay small. */
export function formatPricesCsv(prices: readonly VenuePrice[]): string {
  const rows = [...prices]
    .sort((a, b) => (priceKey(a) < priceKey(b) ? -1 : 1))
    .map((p) =>
      [p.venueId, p.item, p.brand ?? '', String(p.cents), p.seen].join(','),
    )
  return [PRICE_COLUMNS.join(','), ...rows].join('\n') + '\n'
}

export function upsertPrice(
  prices: readonly VenuePrice[],
  price: VenuePrice,
): VenuePrice[] {
  const key = priceKey(price)
  return [...prices.filter((p) => priceKey(p) !== key), price]
}

export function removePrice(
  prices: readonly VenuePrice[],
  key: string,
): VenuePrice[] {
  return prices.filter((p) => priceKey(p) !== key)
}

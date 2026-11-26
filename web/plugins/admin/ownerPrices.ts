import { z } from 'zod'
import {
  priceKey,
  venuePriceSchema,
  type VenuePrice,
} from '../../src/admin/pricesCsv.ts'

/**
 * The prices the owner saves from the phone (owner mode) live in the API's
 * database. Publish copies them into venue_prices.csv first (#263), so the
 * repo keeps them, offline visitors see them and they are versioned like any
 * other price.
 */

/** The API's admin connection, from web/.env.local. */
export type PriceApi = { api: string; token: string }

const ownerPricesResponse = z.object({
  prices: z.array(
    z.object({
      venue_id: z.string(),
      item: z.string(),
      brand: z.string().nullable(),
      cents: z.number(),
      seen: z.string(),
    }),
  ),
})

/** The owner's prices from the API; rows the CSV can't hold are left out. */
export async function fetchOwnerPrices(
  { api, token }: PriceApi,
  fetcher: typeof fetch = fetch,
): Promise<VenuePrice[]> {
  const response = await fetcher(`${api}/v1/admin/owner-prices`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`owner prices: HTTP ${response.status}`)
  const { prices } = ownerPricesResponse.parse(await response.json())
  return prices.flatMap((row) => {
    const parsed = venuePriceSchema.safeParse({
      venueId: row.venue_id,
      item: row.item,
      brand: row.brand || null,
      cents: row.cents,
      seen: row.seen,
    })
    return parsed.success ? [parsed.data] : []
  })
}

/**
 * `csv` with the owner's prices merged in: an owner price replaces the CSV's
 * for the same venue, item and brand unless the CSV's was seen later (the
 * same day, the owner's wins: it was seen at the bar). Returns how many rows
 * it added or changed.
 */
export function mergeOwnerPrices(
  csv: readonly VenuePrice[],
  owner: readonly VenuePrice[],
): { prices: VenuePrice[]; changed: number } {
  const byKey = new Map(csv.map((p) => [priceKey(p), p]))
  let changed = 0
  for (const price of owner) {
    const current = byKey.get(priceKey(price))
    if (current && current.seen > price.seen) continue
    if (current && current.cents === price.cents && current.seen === price.seen)
      continue
    byKey.set(priceKey(price), price)
    changed++
  }
  return { prices: [...byKey.values()], changed }
}

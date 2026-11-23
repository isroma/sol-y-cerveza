import { z } from 'zod'
import { BRANDS, ITEMS, type Brand, type Item } from '../data/prices.ts'
import type { Price } from '../data/terraces.ts'

/** The suggestions API (api/), or null when this build has none configured. */
export const PRICES_API: string | null = import.meta.env.VITE_PRICES_API || null
export const TURNSTILE_SITE_KEY: string | null =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || null

const crowdSchema = z.object({
  prices: z.array(
    z.object({
      venueId: z.string(),
      item: z.enum(ITEMS),
      brand: z.enum(BRANDS).nullable(),
      cents: z.number().int(),
      voters: z.number().int(),
      last: z.string(),
    }),
  ),
})

export type CrowdPrice = z.infer<typeof crowdSchema>['prices'][number]

/** A price line on the card: confirmed by a curator, or agreed by visitors (~). */
export type ShownPrice = {
  item: Item
  brand: Brand | null
  cents: number
  approximate: boolean
}

let crowd: Promise<CrowdPrice[]> | null = null

/** Prices visitors agree on, fetched once per page load; [] on any failure. */
export function loadCrowdPrices(): Promise<CrowdPrice[]> {
  if (!PRICES_API) return Promise.resolve([])
  crowd ??= fetch(`${PRICES_API}/v1/prices`)
    .then((response) => response.json())
    .then((body) => crowdSchema.parse(body).prices)
    .catch(() => [])
  return crowd
}

/**
 * What the card shows for a venue: curator prices win over visitor ones for
 * the same item and brand. Caña first, then tercios by brand order.
 */
export function shownPrices(
  venueId: string,
  curated: readonly Price[],
  visitors: readonly CrowdPrice[],
): ShownPrice[] {
  const key = (p: { item: Item; brand: Brand | null }) =>
    `${p.item}|${p.brand ?? ''}`
  const shown = new Map<string, ShownPrice>()
  for (const p of visitors)
    if (p.venueId === venueId)
      shown.set(key(p), { ...pick(p), approximate: true })
  for (const p of curated) shown.set(key(p), { ...pick(p), approximate: false })
  const rank = (p: ShownPrice) =>
    p.item === 'cana' ? -1 : BRANDS.indexOf(p.brand ?? 'cruzcampo')
  return [...shown.values()].sort((a, b) => rank(a) - rank(b))
}

function pick(p: { item: Item; brand: Brand | null; cents: number }) {
  return { item: p.item, brand: p.brand, cents: p.cents }
}

export type SuggestResult = 'ok' | 'rate-limited' | 'bot' | 'error'

export async function suggestPrice(suggestion: {
  venueId: string
  item: Item
  brand: Brand | null
  cents: number
  token: string
}): Promise<SuggestResult> {
  if (!PRICES_API) return 'error'
  try {
    const response = await fetch(`${PRICES_API}/v1/suggestions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(suggestion),
    })
    if (response.ok) return 'ok'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return 'bot'
    return 'error'
  } catch {
    return 'error'
  }
}

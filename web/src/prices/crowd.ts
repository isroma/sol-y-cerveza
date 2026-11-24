import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { BRANDS, ITEMS, type Brand, type Item } from '../data/prices.ts'
import type { Price } from '../data/terraces.ts'

/** The suggestions API (api/), or null when this build has none configured. */
export const PRICES_API: string | null = import.meta.env.VITE_PRICES_API || null
export const TURNSTILE_SITE_KEY: string | null =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || null

const crowdPriceSchema = z.object({
  venueId: z.string(),
  item: z.enum(ITEMS),
  brand: z.enum(BRANDS).nullable(),
  cents: z.number().int(),
  voters: z.number().int(),
  last: z.string(),
  // Saved by the owner (owner mode): shown as confirmed, no "~".
  confirmed: z.boolean().default(false),
})

/** The answer's shape is checked strictly, each price on its own. */
const crowdSchema = z.object({ prices: z.array(z.unknown()) })

export type CrowdPrice = z.infer<typeof crowdPriceSchema>

/**
 * The prices in an API answer. A price this client can't read (e.g. a brand
 * it doesn't know yet) is left out instead of discarding all of them; an
 * answer of the wrong shape throws.
 */
export function parseCrowdPrices(body: unknown): CrowdPrice[] {
  return crowdSchema.parse(body).prices.flatMap((price) => {
    const parsed = crowdPriceSchema.safeParse(price)
    return parsed.success ? [parsed.data] : []
  })
}

/** A price line on the card: confirmed by a curator, or agreed by visitors (~). */
export type ShownPrice = {
  item: Item
  brand: Brand | null
  cents: number
  approximate: boolean
}

let crowd: Promise<CrowdPrice[]> | null = null
let latest: CrowdPrice[] = []
const listeners = new Set<() => void>()

let requests = 0

function fetchPrices(fresh: boolean): Promise<CrowdPrice[]> {
  if (!PRICES_API) return Promise.resolve([])
  const mine = ++requests
  return fetch(`${PRICES_API}/v1/prices`, fresh ? { cache: 'no-store' } : {})
    .then((response) => response.json())
    .then(parseCrowdPrices)
    .catch(() => latest)
    .then((prices) => {
      // An older, slower answer never replaces a newer one.
      if (mine !== requests) return latest
      latest = prices
      for (const listener of listeners) listener()
      return prices
    })
}

/** Prices from the API (visitors' consensus and the owner's), fetched once per page load; [] on any failure. */
export function loadCrowdPrices(): Promise<CrowdPrice[]> {
  crowd ??= fetchPrices(false)
  return crowd
}

/** Fetches again, e.g. right after the owner saved a price. */
export function refreshCrowdPrices(): Promise<CrowdPrice[]> {
  crowd = fetchPrices(true)
  return crowd
}

/** The latest API prices; re-renders when they change. */
export function useCrowdPrices(): CrowdPrice[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      void loadCrowdPrices()
      return () => listeners.delete(listener)
    },
    () => latest,
  )
}

/**
 * What the card shows for a venue, per item and brand: the owner's price
 * (owner mode) wins, then the curator's, then visitors' consensus (~).
 * Caña first, then tercios by brand order.
 */
export function shownPrices(
  venueId: string,
  curated: readonly Price[],
  visitors: readonly CrowdPrice[],
): ShownPrice[] {
  const key = (p: { item: Item; brand: Brand | null }) =>
    `${p.item}|${p.brand ?? ''}`
  const shown = new Map<string, ShownPrice>()
  const here = visitors.filter((p) => p.venueId === venueId)
  for (const p of here)
    if (!p.confirmed) shown.set(key(p), { ...pick(p), approximate: true })
  for (const p of curated) shown.set(key(p), { ...pick(p), approximate: false })
  for (const p of here)
    if (p.confirmed) shown.set(key(p), { ...pick(p), approximate: false })
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

/** True when visitors can suggest prices (the API and bot check are set up). */
export const CAN_SUGGEST = PRICES_API !== null && TURNSTILE_SITE_KEY !== null

/** What a visitor sees after suggesting a price. */
export const PRICE_RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
  'rate-limited':
    'Hay demasiados precios enviados desde tu conexión o para este bar. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

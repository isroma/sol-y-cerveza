import { z } from 'zod'
import { BRANDS, ITEMS } from './prices.ts'

/** Relative, so it resolves under /sol-y-cerveza/ on GitHub Pages and inside Capacitor. */
export const TERRACES_URL = './data/terraces.json'

export const HORIZON_BINS = 360

// Mirrors docs/data-contract.md (version 2).
const latLonSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
})

const priceSchema = z
  .object({
    item: z.enum(ITEMS),
    brand: z.enum(BRANDS).nullable(),
    cents: z.number().int().min(50).max(1500),
    seen: z.iso.date(),
  })
  .refine((p) => (p.item === 'tercio') === (p.brand !== null), {
    message: 'a tercio needs a brand and a caña has none',
  })

const terraceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['bar', 'pub', 'cafe', 'restaurant', 'biergarten']),
  venue: latLonSchema,
  // Null when no terrace is known for the venue (then verified and horizon are null too).
  terrace: latLonSchema.nullable(),
  sources: z.array(z.string()),
  verified: z.iso.date().nullable(),
  // Tenths of a degree per compass azimuth bin, 0 = north, clockwise.
  horizon: z
    .array(z.number().int().min(0).max(900))
    .length(HORIZON_BINS)
    .nullable(),
  // Curator-confirmed prices; files before 2026-11-23 have none.
  prices: z.array(priceSchema).optional(),
})

export const terracesFileSchema = z.object({
  version: z.literal(2),
  generated: z.iso.datetime(),
  sample: z.boolean(),
  attribution: z.array(z.string()),
  terraces: z.array(terraceSchema),
})

export type LatLon = z.infer<typeof latLonSchema>
export type Price = z.infer<typeof priceSchema>
export type Terrace = z.infer<typeof terraceSchema>
export type TerracesFile = z.infer<typeof terracesFileSchema>

export async function loadTerraces(): Promise<TerracesFile> {
  const response = await fetch(TERRACES_URL)
  if (!response.ok) {
    throw new Error(`Failed to load ${TERRACES_URL}: HTTP ${response.status}`)
  }
  return terracesFileSchema.parse(await response.json())
}

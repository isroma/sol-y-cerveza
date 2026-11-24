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

const horizonSchema = z
  .array(z.number().int().min(0).max(900))
  .length(HORIZON_BINS)

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
  horizon: horizonSchema.nullable(),
  // The same with deciduous trees bare, used from 1 Dec to 15 Mar
  // (ADR-0007). Null or absent: same as `horizon`.
  horizon_winter: horizonSchema.nullable().optional(),
  // Curator-confirmed prices; files before 2026-11-23 have none.
  prices: z.array(priceSchema).optional(),
})

/** One record, with the rules that span its fields. */
const terraceRecordSchema = terraceSchema.refine(
  (t) => t.horizon !== null || (t.horizon_winter ?? null) === null,
  { message: 'horizon_winter needs a horizon' },
)

/** The whole file, every record valid (what the pipeline must produce). */
export const terracesFileSchema = z.object({
  version: z.literal(2),
  generated: z.iso.datetime(),
  sample: z.boolean(),
  attribution: z.array(z.string()),
  terraces: z.array(terraceRecordSchema),
})

/** The file around its records: checked strictly, the records one by one. */
const terracesEnvelopeSchema = terracesFileSchema.extend({
  terraces: z.array(z.unknown()),
})

export type LatLon = z.infer<typeof latLonSchema>
export type Price = z.infer<typeof priceSchema>
export type Terrace = z.infer<typeof terraceSchema>
export type TerracesFile = z.infer<typeof terracesFileSchema>

/** A loaded file, and how many of its records were invalid and left out. */
export type LoadedTerraces = { file: TerracesFile; dropped: number }

/**
 * Validates a terraces.json. A wrong version or top-level shape throws; an
 * invalid record (e.g. a `kind` or price brand this client doesn't know yet)
 * is left out and counted, so one bad record never blanks the whole map.
 */
export function parseTerracesFile(json: unknown): LoadedTerraces {
  const envelope = terracesEnvelopeSchema.parse(json)
  const terraces: Terrace[] = []
  for (const record of envelope.terraces) {
    const parsed = terraceRecordSchema.safeParse(record)
    if (parsed.success) terraces.push(parsed.data)
  }
  return {
    file: { ...envelope, terraces },
    dropped: envelope.terraces.length - terraces.length,
  }
}

export async function loadTerraces(): Promise<LoadedTerraces> {
  const response = await fetch(TERRACES_URL)
  if (!response.ok) {
    throw new Error(`Failed to load ${TERRACES_URL}: HTTP ${response.status}`)
  }
  return parseTerracesFile(await response.json())
}

// zod/mini: the same checks as classic zod at a third of its size in the
// entry chunk (classic always bundles its JSON Schema converter).
import * as z from 'zod/mini'
import { BRANDS, ITEMS } from './prices.ts'

/** Relative, so it resolves under /sol-y-cerveza/ on GitHub Pages and inside Capacitor. */
export const TERRACES_URL = './data/terraces.json'

export const HORIZON_BINS = 360

// Mirrors docs/data-contract.md (version 2).
const latLonSchema = z.object({
  lat: z.number().check(z.minimum(-90), z.maximum(90)),
  lon: z.number().check(z.minimum(-180), z.maximum(180)),
})

/** A horizon bin: a whole number of tenths of a degree, 0 to 90°. */
const isHorizonBin = (bin: number) =>
  Number.isSafeInteger(bin) && bin >= 0 && bin <= 900

// One check over the array rather than a schema per bin: the same rule as
// z.int().check(z.minimum(0), z.maximum(900)) on each element, at about a
// third of the parse time on 360-bin arrays.
const horizonSchema = z.array(z.number()).check(
  z.length(HORIZON_BINS),
  z.refine((horizon) => horizon.every(isHorizonBin), {
    message: 'horizon bins are integers from 0 to 900',
  }),
)

const priceSchema = z
  .object({
    item: z.enum(ITEMS),
    brand: z.nullable(z.enum(BRANDS)),
    cents: z.int().check(z.minimum(50), z.maximum(1500)),
    seen: z.iso.date(),
  })
  .check(
    z.refine((p) => (p.item === 'tercio') === (p.brand !== null), {
      message: 'a tercio needs a brand and a caña has none',
    }),
  )

const terraceSchema = z.object({
  id: z.string().check(z.minLength(1)),
  name: z.string().check(z.minLength(1)),
  kind: z.enum(['bar', 'pub', 'cafe', 'restaurant', 'biergarten']),
  venue: latLonSchema,
  // Null when no terrace is known for the venue (then verified and horizon are null too).
  terrace: z.nullable(latLonSchema),
  sources: z.array(z.string()),
  verified: z.nullable(z.iso.date()),
  // Tenths of a degree per compass azimuth bin, 0 = north, clockwise.
  horizon: z.nullable(horizonSchema),
  // The same with deciduous trees bare, used from 1 Dec to 15 Mar
  // (ADR-0007). Null or absent: same as `horizon`.
  horizon_winter: z.optional(z.nullable(horizonSchema)),
  // Lowest obstacle per bin over ground points across the terrace, packed as
  // 360 characters in whole degrees (docs/data-contract.md): sun when any part
  // of the terrace has it. Null or absent: same as `horizon`. `unpackHorizon`
  // checks it as it decodes, once per day, and treats a malformed one as absent.
  horizon_low: z.optional(z.nullable(z.string())),
  // The same in the leaf-off period. Null or absent: same as `horizon_low`.
  horizon_low_winter: z.optional(z.nullable(z.string())),
  // Curator-confirmed prices; files before 2026-11-23 have none.
  prices: z.optional(z.array(priceSchema)),
})

/** One record, with the rules that span its fields. */
const terraceRecordSchema = terraceSchema.check(
  z.refine((t) => t.horizon !== null || (t.horizon_winter ?? null) === null, {
    message: 'horizon_winter needs a horizon',
  }),
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
const terracesEnvelopeSchema = z.extend(terracesFileSchema, {
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

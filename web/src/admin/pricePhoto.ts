import { z } from 'zod'
import { BRANDS, ITEMS } from '../data/prices.ts'
import {
  base64Bytes,
  MAX_CENTS,
  MIN_CENTS,
  PHOTO_MAX_BYTES,
  PHOTO_MEDIA_TYPES,
  sniffImage,
  toProposals,
  type PhotoMediaType,
} from '../data/photoReading.ts'

export * from '../data/photoReading.ts'

/**
 * Reading beer prices from a photo of a bar's price board (admin only).
 * Pure: shared by the admin page (PricePhoto.tsx) and its dev-server endpoint
 * (web/pricePhotoServer.ts), which sends the photo to the Claude API.
 */

// --- Upload (browser -> dev server) -----------------------------------------

export type PhotoUpload = { image: string; mediaType: PhotoMediaType }

const uploadSchema = z.object({
  image: z.string().min(1),
  mediaType: z.enum(PHOTO_MEDIA_TYPES),
})

/** Validates the endpoint's request body: a base64 image of at most 5 MB. */
export function parsePhotoUpload(
  body: unknown,
):
  | { ok: true; upload: PhotoUpload }
  | { ok: false; status: number; error: string } {
  const parsed = uploadSchema.safeParse(body)
  if (!parsed.success)
    return {
      ok: false,
      status: 400,
      error: 'send {image: <base64>, mediaType: image/jpeg|png|webp|gif}',
    }
  const { image, mediaType } = parsed.data
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    return { ok: false, status: 400, error: 'image is not base64' }
  if (base64Bytes(image) > PHOTO_MAX_BYTES)
    return { ok: false, status: 413, error: 'the photo is larger than 5 MB' }
  const sniffed = sniffImage(image)
  if (sniffed === null)
    return { ok: false, status: 415, error: 'the file is not an image' }
  if (sniffed !== mediaType)
    return {
      ok: false,
      status: 415,
      error: `the image is ${sniffed}, not ${mediaType}`,
    }
  return { ok: true, upload: { image, mediaType } }
}

const readPriceSchema = z.object({
  item: z.enum(ITEMS),
  brand: z.enum(BRANDS).nullable(),
  cents: z.number().int(),
  label: z.string(),
  confidence: z.enum(['high', 'low']),
})

const readingSchema = z.object({
  prices: z.array(readPriceSchema),
  notes: z.array(z.string()),
})

export const photoResultSchema = z.object({
  proposals: z.array(
    z.object({
      item: z.enum(ITEMS),
      brand: z.enum(BRANDS).nullable(),
      cents: z.number().int().min(MIN_CENTS).max(MAX_CENTS),
      label: z.string(),
      confidence: z.enum(['high', 'low']),
    }),
  ),
  notes: z.array(z.string()),
})

export type PhotoResult = z.infer<typeof photoResultSchema>

/** The endpoint's answer: a result, or an error message. */
export const photoResponseSchema = z.union([
  photoResultSchema,
  z.object({ error: z.string() }),
])

/**
 * Parses the model's JSON text (the structured output) into proposals.
 * Returns null when it does not match the schema.
 */
export function parseModelReading(text: string): PhotoResult | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = readingSchema.safeParse(json)
  if (!parsed.success) return null
  const result = toProposals(parsed.data.prices)
  const notes = parsed.data.notes.map((n) => n.trim()).filter(Boolean)
  return { proposals: result.proposals, notes: [...notes, ...result.notes] }
}

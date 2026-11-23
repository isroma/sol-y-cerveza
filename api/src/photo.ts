/**
 * Owner photo reading: beer prices and the bar's name from a photo of a price
 * board, read by the Claude API. The prompt, schema and price rules are the
 * admin's (web/src/data/photoReading.ts); this adds the bar's name.
 */
import Anthropic from '@anthropic-ai/sdk'
import {
  base64Bytes,
  PHOTO_MAX_BYTES,
  PHOTO_MEDIA_TYPES,
  PHOTO_OUTPUT_SCHEMA,
  PHOTO_SYSTEM_PROMPT,
  sniffImage,
  toProposals,
  type PhotoMediaType,
  type PhotoReading,
  type ReadPrice,
} from '../../web/src/data/photoReading.ts'
import { BRANDS, ITEMS } from '../../web/src/data/prices.ts'

export const PHOTO_MODEL = 'claude-opus-5-5'

const OUTPUT_SCHEMA = {
  ...PHOTO_OUTPUT_SCHEMA,
  required: [...PHOTO_OUTPUT_SCHEMA.required, 'bar_name'],
  properties: {
    ...PHOTO_OUTPUT_SCHEMA.properties,
    bar_name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
}

const SYSTEM_PROMPT = `${PHOTO_SYSTEM_PROMPT}

Field "bar_name": the bar's or restaurant's own name if the photo shows it (a sign, the menu's header, a logo), written as shown; null if it doesn't. Never guess it from the style of the place.`

const USER_PROMPT =
  'Read the beer prices (caña, and tercios by brand) and the bar name from this photo.'

export type OwnerPhotoResult = PhotoReading & { barName: string | null }

export class PhotoError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function isMediaType(value: unknown): value is PhotoMediaType {
  return PHOTO_MEDIA_TYPES.some((t) => t === value)
}

/** Validates `{image: <base64>, mediaType}`: at most 5 MB, really that image type. */
export function parsePhoto(body: unknown): { image: string; mediaType: PhotoMediaType } {
  if (typeof body !== 'object' || body === null) throw new PhotoError(400, 'send {image, mediaType}')
  const { image, mediaType } = body as Record<string, unknown>
  if (typeof image !== 'string' || !isMediaType(mediaType))
    throw new PhotoError(400, 'send {image: <base64>, mediaType: image/jpeg|png|webp|gif}')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new PhotoError(400, 'image is not base64')
  if (base64Bytes(image) > PHOTO_MAX_BYTES) throw new PhotoError(413, 'the photo is larger than 5 MB')
  if (sniffImage(image) !== mediaType) throw new PhotoError(415, 'the file is not that image type')
  return { image, mediaType }
}

/** The model's structured output, checked field by field (no zod in the Worker). */
export function parseReading(text: string): OwnerPhotoResult | null {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const { prices, notes, bar_name: barName } = json as Record<string, unknown>
  if (!Array.isArray(prices) || !Array.isArray(notes)) return null
  const read: ReadPrice[] = []
  for (const p of prices) {
    if (typeof p !== 'object' || p === null) return null
    const { item, brand, cents, label, confidence } = p as Record<string, unknown>
    const knownItem = ITEMS.find((i) => i === item)
    const knownBrand = BRANDS.find((b) => b === brand)
    if (!knownItem || (brand !== null && !knownBrand)) return null
    if (typeof cents !== 'number' || !Number.isInteger(cents) || typeof label !== 'string')
      return null
    if (confidence !== 'high' && confidence !== 'low') return null
    read.push({ item: knownItem, brand: knownBrand ?? null, cents, label, confidence })
  }
  const result = toProposals(read)
  const modelNotes = notes.filter((n): n is string => typeof n === 'string' && n.trim() !== '')
  return {
    proposals: result.proposals,
    notes: [...modelNotes, ...result.notes],
    barName: typeof barName === 'string' && barName.trim() ? barName.trim() : null,
  }
}

/** Sends the photo to the Claude API; the photo isn't stored anywhere. */
export async function readPhoto(
  apiKey: string,
  photo: { image: string; mediaType: PhotoMediaType },
): Promise<OwnerPhotoResult> {
  if (!apiKey) throw new PhotoError(503, 'photo reading is not set up (ANTHROPIC_API_KEY)')
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 })
  let message
  try {
    message = await client.beta.messages.create({
      model: PHOTO_MODEL,
      max_tokens: 16000,
      // On a policy decline, retry on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: photo.mediaType, data: photo.image },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError)
      throw new PhotoError(502, 'the Claude API rejected the key')
    if (error instanceof Anthropic.RateLimitError)
      throw new PhotoError(429, 'Claude API rate limit: try again soon')
    if (error instanceof Anthropic.APIConnectionError)
      throw new PhotoError(502, `could not reach the Claude API: ${error.message}`)
    if (error instanceof Anthropic.APIError)
      throw new PhotoError(502, `Claude API error ${error.status ?? ''}: ${error.message}`)
    throw error
  }
  if (message.stop_reason === 'refusal') throw new PhotoError(422, 'Claude declined to read this photo')
  if (message.stop_reason === 'max_tokens') throw new PhotoError(502, 'the answer was cut off: try again')
  const text = message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
  const result = parseReading(text)
  if (!result) throw new PhotoError(502, 'Claude answered in an unexpected shape')
  return result
}

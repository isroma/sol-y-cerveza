/**
 * Owner photo reading: beer prices and the bar's name from a photo of a price
 * board, read by a Workers AI vision model (free daily allowance, zero data
 * retention). The prompt, schema and price rules are the admin's
 * (web/src/data/photoReading.ts); this adds the bar's name.
 */
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

// Not Llama 4 or Llama 3.2 Vision: their licence withholds the multimodal
// rights from EU-based developers.
export const PHOTO_MODEL = '@cf/google/gemma-4-26b-a4b-it'
/** Photos owner mode may send to the Claude API per rolling 24 hours: bounds the spend of a leaked OWNER_TOKEN. */
export const PHOTO_DAILY_LIMIT = 50

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
export function parsePhoto(body: unknown): {
  image: string
  mediaType: PhotoMediaType
} {
  if (typeof body !== 'object' || body === null)
    throw new PhotoError(400, 'send {image, mediaType}')
  const { image, mediaType } = body as Record<string, unknown>
  if (typeof image !== 'string' || !isMediaType(mediaType))
    throw new PhotoError(
      400,
      'send {image: <base64>, mediaType: image/jpeg|png|webp|gif}',
    )
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image))
    throw new PhotoError(400, 'image is not base64')
  if (base64Bytes(image) > PHOTO_MAX_BYTES)
    throw new PhotoError(413, 'the photo is larger than 5 MB')
  if (sniffImage(image) !== mediaType)
    throw new PhotoError(415, 'the file is not that image type')
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
    const { item, brand, cents, label, confidence } = p as Record<
      string,
      unknown
    >
    const knownItem = ITEMS.find((i) => i === item)
    const knownBrand = BRANDS.find((b) => b === brand)
    if (!knownItem || (brand !== null && !knownBrand)) return null
    if (
      typeof cents !== 'number' ||
      !Number.isInteger(cents) ||
      typeof label !== 'string'
    )
      return null
    if (confidence !== 'high' && confidence !== 'low') return null
    read.push({
      item: knownItem,
      brand: knownBrand ?? null,
      cents,
      label,
      confidence,
    })
  }
  const result = toProposals(read)
  const modelNotes = notes.filter(
    (n): n is string => typeof n === 'string' && n.trim() !== '',
  )
  return {
    proposals: result.proposals,
    notes: [...modelNotes, ...result.notes],
    barName:
      typeof barName === 'string' && barName.trim() ? barName.trim() : null,
  }
}

/**
 * The part of the Workers AI binding (`env.AI`) used here, declared locally so
 * this module also type-checks under the tests' Node types.
 */
export type PhotoAi = {
  run(
    model: typeof PHOTO_MODEL,
    inputs: object,
  ): Promise<{
    choices: {
      finish_reason?: string | null
      message: { content?: string | null }
    }[]
  }>
}

/** Sends the photo to Workers AI; the photo isn't stored anywhere. */
export async function readPhoto(
  ai: PhotoAi,
  photo: { image: string; mediaType: PhotoMediaType },
): Promise<OwnerPhotoResult> {
  let output
  try {
    output = await ai.run(PHOTO_MODEL, {
      // Reading a board needs no reasoning, and with it on, Gemma reasons
      // for minutes over a full-size photo and runs out of tokens.
      chat_template_kwargs: { enable_thinking: false },
      max_tokens: 2048,
      temperature: 0,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'photo_reading',
          schema: OUTPUT_SCHEMA,
          strict: true,
        },
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${photo.mediaType};base64,${photo.image}`,
              },
            },
            { type: 'text', text: USER_PROMPT },
          ],
        },
      ],
    })
  } catch (error) {
    if (error instanceof Error)
      throw new PhotoError(502, `Workers AI error: ${error.message}`)
    throw error
  }
  const [choice] = output.choices
  if (choice?.finish_reason === 'length')
    throw new PhotoError(502, 'the answer was cut off: try again')
  const text = choice?.message.content
  const result = typeof text === 'string' ? parseReading(text) : null
  if (!result)
    throw new PhotoError(502, 'the model answered in an unexpected shape')
  return result
}

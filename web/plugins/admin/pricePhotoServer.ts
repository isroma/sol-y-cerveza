import type { IncomingMessage } from 'node:http'
import {
  parseModelReading,
  parsePhotoUpload,
  PHOTO_MAX_BYTES,
  PHOTO_OUTPUT_SCHEMA,
  PHOTO_SYSTEM_PROMPT,
  PHOTO_USER_PROMPT,
  type PhotoResult,
  type PhotoUpload,
} from '../../src/admin/pricePhoto.ts'

/**
 * Dev-server only: reads beer prices from a photo of a price board with the
 * Claude API (vision + structured output). The key is ANTHROPIC_API_KEY in
 * web/.env.local; the photo is sent to Anthropic and not kept here.
 */

export const PHOTO_MODEL = 'claude-opus-5-5'

export const NO_KEY_HINT =
  'Set ANTHROPIC_API_KEY in web/.env.local and restart `npm run admin` to read prices from a photo.'

/** A failure with the HTTP status the admin should get. */
export class PhotoReadError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export type ReadPhoto = (upload: PhotoUpload) => Promise<PhotoResult>

/** Sends the photo to the Claude API and validates what comes back. */
export function claudeReader(apiKey: string): ReadPhoto {
  return async (upload) => {
    // Loaded on first use, so the build (which loads vite.config.ts) never needs it.
    const { default: Anthropic } = await import('@anthropic-ai/sdk')
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
          format: { type: 'json_schema', schema: PHOTO_OUTPUT_SCHEMA },
        },
        system: PHOTO_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: upload.mediaType,
                  data: upload.image,
                },
              },
              { type: 'text', text: PHOTO_USER_PROMPT },
            ],
          },
        ],
      })
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError)
        throw new PhotoReadError(
          401,
          'the Claude API rejected ANTHROPIC_API_KEY (web/.env.local)',
        )
      if (error instanceof Anthropic.RateLimitError)
        throw new PhotoReadError(429, 'Claude API rate limit: try again soon')
      // A connection error is also an APIError, so it goes first.
      if (error instanceof Anthropic.APIConnectionError)
        throw new PhotoReadError(
          502,
          `could not reach the Claude API: ${error.message}`,
        )
      if (error instanceof Anthropic.APIError)
        throw new PhotoReadError(
          502,
          `Claude API error ${error.status ?? ''}: ${error.message}`,
        )
      throw error
    }
    if (message.stop_reason === 'refusal')
      throw new PhotoReadError(422, 'Claude declined to read this photo')
    if (message.stop_reason === 'max_tokens')
      throw new PhotoReadError(502, 'the answer was cut off: try again')
    const text = message.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
    const result = parseModelReading(text)
    if (result === null)
      throw new PhotoReadError(502, 'Claude answered in an unexpected shape')
    return result
  }
}

/** GET: whether the button can work. */
export function photoStatus(apiKey: string) {
  return apiKey ? { enabled: true } : { enabled: false, hint: NO_KEY_HINT }
}

/** POST: validates the upload, reads it and answers with status and body. */
export async function answerPhoto(
  body: unknown,
  apiKey: string,
  read: ReadPhoto,
): Promise<{ status: number; body: unknown }> {
  if (!apiKey) return { status: 503, body: { error: NO_KEY_HINT } }
  const upload = parsePhotoUpload(body)
  if (!upload.ok)
    return { status: upload.status, body: { error: upload.error } }
  try {
    return { status: 200, body: await read(upload.upload) }
  } catch (error) {
    if (error instanceof PhotoReadError)
      return { status: error.status, body: { error: error.message } }
    return { status: 502, body: { error: String(error) } }
  }
}

/** Base64 of the largest photo, plus room for the JSON around it. */
export const PHOTO_MAX_BODY = Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 1024

/** Reads a JSON body, or null when it is larger than `max` bytes or not JSON. */
export async function readJsonCapped(
  req: IncomingMessage,
  max: number,
): Promise<{ ok: true; json: unknown } | { ok: false; status: number }> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    size += buffer.length
    if (size > max) return { ok: false, status: 413 }
    chunks.push(buffer)
  }
  try {
    return { ok: true, json: JSON.parse(Buffer.concat(chunks).toString()) }
  } catch {
    return { ok: false, status: 400 }
  }
}

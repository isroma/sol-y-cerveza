import { safeEqual } from './logic.ts'

/** The largest JSON body, in bytes, of every endpoint but the photo one. */
export const MAX_BODY = 8 * 1024
/** A downscaled photo (about 0.5 MB) as base64, with room to spare, in bytes. */
export const MAX_PHOTO_BODY = 7 * 1024 * 1024

export function json(
  body: unknown,
  status: number,
  headers: HeadersInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/**
 * The request's body as text, or null when it is over `maxBytes`: refused on its
 * Content-Length before reading, and the read itself stops at `maxBytes` bytes.
 */
export async function boundedText(
  request: Request,
  maxBytes: number,
): Promise<string | null> {
  const declared = request.headers.get('Content-Length')
  if (declared !== null && !(Number(declared) <= maxBytes)) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk =
      value instanceof Uint8Array
        ? value
        : new TextEncoder().encode(String(value))
    total += chunk.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

/** A JSON body of at most `maxBytes` bytes, or the error response to send. */
export async function jsonBody(
  request: Request,
  maxBytes = MAX_BODY,
  tooLarge = 'too large',
): Promise<{ body: unknown } | Response> {
  const text = await boundedText(request, maxBytes)
  if (text === null) return json({ error: tooLarge }, 413)
  try {
    return { body: JSON.parse(text) }
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
}

export function bearer(request: Request, token: string | undefined): boolean {
  return (
    Boolean(token) &&
    safeEqual(request.headers.get('Authorization') ?? '', `Bearer ${token}`)
  )
}

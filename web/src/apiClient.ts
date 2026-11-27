/**
 * The app's link to our API (api/): where it is, the bot check's site key,
 * and the one POST that price suggestions, venue reports and card-back
 * changes share. Both values come from the build (`VITE_PRICES_API`,
 * `VITE_TURNSTILE_SITE_KEY`); without them the app makes no API calls.
 */

/** The API's base URL, or null when this build has none configured. */
export const PRICES_API: string | null = import.meta.env.VITE_PRICES_API || null
/** Cloudflare Turnstile's public site key, or null. */
export const TURNSTILE_SITE_KEY: string | null =
  import.meta.env.VITE_TURNSTILE_SITE_KEY || null

/** Visitors can send prices and reports: the build has the API and the bot check. */
export const CAN_SEND = PRICES_API !== null && TURNSTILE_SITE_KEY !== null

/**
 * How a visitor's POST went, for the message they see. `not-sunny`: a shade
 * report the API refused because the sun isn't out over Badajoz (ADR-0014).
 */
export type SuggestResult =
  'ok' | 'rate-limited' | 'bot' | 'not-sunny' | 'error'

/** A refused POST's result: `not-sunny` when the API says so, else `error`. */
export async function refusal(response: Response): Promise<SuggestResult> {
  if (response.status !== 400) return 'error'
  try {
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      Reflect.get(body, 'error') === 'not sunny'
      ? 'not-sunny'
      : 'error'
  } catch {
    return 'error'
  }
}

/** POSTs `body` as JSON to `path` on the API; never throws. */
export async function postJson(
  path: string,
  body: unknown,
): Promise<SuggestResult> {
  if (!PRICES_API) return 'error'
  try {
    const response = await fetch(`${PRICES_API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return 'ok'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return 'bot'
    return await refusal(response)
  } catch {
    return 'error'
  }
}

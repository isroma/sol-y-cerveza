import type { IncomingHttpHeaders } from 'node:http'

/** What the guard needs from a request, so it can be tested without a server. */
export type AdminRequest = {
  method: string | undefined
  headers: IncomingHttpHeaders
  /** True when the dev server runs over TLS (`server.https`). */
  secure: boolean
}

function header(headers: IncomingHttpHeaders, name: string): string | null {
  const value = headers[name]
  const first = Array.isArray(value) ? value[0] : value
  return first === undefined ? null : first
}

/**
 * Why a request to a `/__admin` endpoint must be refused, or null to let it
 * through. The admin endpoints change files, push to git (Publish), spend
 * Claude credits (photo) and forward the API admin token, so a page on another
 * site must not be able to drive them while `npm run admin` runs.
 *
 * Every method, GET and HEAD included, needs `Sec-Fetch-Site`, when present,
 * not to be `cross-site` or `same-site`. Vite's CORS policy keeps other
 * origins from reading an answer, but not from sending the request: a
 * `no-cors` fetch loop from any page would still run GET handlers such as
 * the probe, which starts a Python process. A missing header (curl, older
 * browsers) passes, like `same-origin` and `none`. The guard covers only
 * `/__admin`, so opening admin.html from a link elsewhere still works.
 *
 * GET and HEAD need nothing more: none of the admin GETs change anything.
 * Every other method also needs:
 * - `Content-Type: application/json`. A cross-origin page can only send that
 *   with fetch, which makes the browser ask first (CORS preflight) and always
 *   sends an Origin header. Forms and `no-cors` fetches can't set it.
 * - `Origin`, when present, equal to the dev server's own origin, taken from
 *   the Host header (Vite's `server.allowedHosts` already refuses unknown
 *   hosts, which stops DNS rebinding).
 *
 * A request with no Origin passes. Browsers always send Origin on a
 * cross-origin request that isn't GET or HEAD (and on fetch with a JSON
 * body), so a missing one means a non-browser client such as curl on the
 * owner's machine, which could edit the files or run git directly anyway.
 */
export function adminRequestRefusal(request: AdminRequest): string | null {
  const { headers } = request
  const fetchSite = header(headers, 'sec-fetch-site')?.toLowerCase() ?? null
  if (fetchSite === 'cross-site' || fetchSite === 'same-site')
    return 'admin requests must come from the admin page'
  const method = (request.method ?? 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD') return null
  const contentType = header(headers, 'content-type') ?? ''
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (mediaType !== 'application/json')
    return 'admin requests must be sent as application/json'
  const origin = header(headers, 'origin')
  if (origin === null) return null
  const host = header(headers, 'host')
  const own =
    host === null ? null : `${request.secure ? 'https' : 'http'}://${host}`
  if (own === null || origin.toLowerCase() !== own.toLowerCase())
    return 'admin requests must come from the admin page'
  return null
}

/**
 * At most one running job, the latest: `start` aborts the one before it, so a
 * dragged pin (or a page firing requests in a loop) never stacks up probe
 * processes. `finish` frees the slot when that job is still the current one.
 */
export function latestOnly(): {
  start: () => AbortController
  finish: (job: AbortController) => void
} {
  let current: AbortController | null = null
  return {
    start() {
      current?.abort()
      current = new AbortController()
      return current
    },
    finish(job) {
      if (current === job) current = null
    },
  }
}

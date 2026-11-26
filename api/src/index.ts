/**
 * Visitor suggestions API (Cloudflare Worker + D1): prices, venue reports, sun.
 *
 * - POST /v1/suggestions: a visitor suggests a price. Turnstile-verified (our
 *   hostname and action), one vote per voter (salted hash of the IPv4 address
 *   or IPv6 /64) per venue, item and brand, daily caps per voter and per
 *   network, an hourly cap per venue, plausible prices only, and only for
 *   venues in the data.
 * - GET /v1/prices: prices at least THRESHOLD networks agree on (shown with "~"),
 *   minus the ones the owner rejected; cached for PRICES_TTL_SECONDS and purged
 *   when the owner changes a price or resolves a suggestion.
 * - GET /v1/admin/suggestions, POST /v1/admin/resolve: the review queue,
 *   for the local admin view only (bearer ADMIN_TOKEN).
 * - Owner mode (bearer OWNER_TOKEN, which can only change prices and send
 *   reports): GET /v1/owner/check, PUT/DELETE /v1/owner/prices saves a
 *   confirmed price, POST /v1/owner/changes is the card back as the owner's
 *   change (a price shows at once; a move, closed, terrace answer or pin waits
 *   for the admin's next Publish, applied without review), POST
 *   /v1/owner/reports adds a missing venue the same way. No bot check and no
 *   caps.
 * - POST /v1/login: the owner's username and password for OWNER_TOKEN, at most
 *   LOGIN_NETWORK_LIMIT attempts per network in 15 minutes and
 *   LOGIN_HOURLY_LIMIT from everyone in an hour.
 * - GET /v1/admin/owner-prices: owner prices, for the admin's import.
 * - POST /v1/reports: a visitor reports a venue that moved, closed or is missing,
 *   whether it has a terrace, or where the terrace is (ADR-0009), with the same
 *   identity and caps as suggestions. Never applied automatically.
 * - POST /v1/changes: the card back's price, move, closed, terrace answer and
 *   tables pin for one venue, behind one bot check (action 'change'), checked
 *   and capped as the two endpoints above would, and stored together or not at
 *   all.
 * - GET /v1/admin/reports, POST /v1/admin/reports/resolve: the reports queue.
 * - Sun reports (ADR-0012): `sun: true` in POST /v1/changes says the sun is on
 *   the terrace now; the Worker works out where the sun is (refused when it is
 *   under MIN_SUN_ALTITUDE). GET /v1/sun serves the horizon corrections that
 *   SUN_THRESHOLD networks agree on (approximate) or the owner accepted
 *   (confirmed), cached like /v1/prices; GET /v1/admin/sun and POST
 *   /v1/admin/sun/resolve are their queue. The owner's own is stored accepted.
 *   GET /v1/admin/sun/accepted lists the accepted ones, which the admin
 *   copies into pipeline/data/sun_corrections.csv for Publish.
 * - POST /v1/events (ADR-0013): anonymous usage counters, `{events: [{name,
 *   value?}]}`, at most MAX_EVENTS. Daily aggregate counts per allowlisted
 *   (name, value) only: no bot check, no voter hash, no IP, nothing about the
 *   visitor; a venue id counts only when it is in the published data. 204,
 *   never cached. GET /v1/admin/stats?days=N reads them (default 30, at most
 *   90).
 * - GET /v1/version: `{build}`, the build fingerprint this Worker was deployed
 *   with (BUILD_ID), or null; never cached. CI's deploy skips an upload the
 *   live Worker already runs and checks that its own upload took effect.
 *
 * It fails closed when misconfigured: no usable IP_SALT means 503 on the
 * endpoints that hash addresses (not POST /v1/events, which hashes nothing),
 * and a Turnstile test secret only passes on localhost.
 */
import type { Env } from './env.ts'
import { bearer, json } from './http.ts'
import { allowedOrigin } from './logic.ts'
import {
  ownerChange,
  ownerPrice,
  ownerPrices,
  ownerReport,
} from './routes/owner.ts'
import { postEvents, stats } from './routes/events.ts'
import { login } from './routes/login.ts'
import { pending, prices, resolve, suggest } from './routes/prices.ts'
import {
  change,
  pendingReports,
  report,
  resolveReports,
} from './routes/reports.ts'
import {
  acceptedSunReports,
  pendingSun,
  resolveSun,
  sun,
} from './routes/sun.ts'

async function route(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const { pathname } = new URL(request.url)
  if (pathname === '/v1/prices' && request.method === 'GET')
    return prices(request, env, ctx)
  if (pathname === '/v1/sun' && request.method === 'GET')
    return sun(request, env, ctx)
  if (pathname === '/v1/version' && request.method === 'GET')
    return json({ build: env.BUILD_ID || null }, 200, {
      'Cache-Control': 'no-store',
    })
  if (pathname === '/v1/suggestions' && request.method === 'POST')
    return suggest(request, env)
  if (pathname === '/v1/changes' && request.method === 'POST')
    return change(request, env)
  if (pathname === '/v1/reports' && request.method === 'POST')
    return report(request, env)
  if (pathname === '/v1/events' && request.method === 'POST')
    return postEvents(request, env)
  if (pathname === '/v1/login' && request.method === 'POST')
    return login(request, env)
  if (pathname.startsWith('/v1/owner/')) {
    if (!bearer(request, env.OWNER_TOKEN))
      return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/owner/check' && request.method === 'GET')
      return json({ ok: true }, 200)
    if (
      pathname === '/v1/owner/prices' &&
      (request.method === 'PUT' || request.method === 'DELETE')
    )
      return ownerPrice(request, env)
    if (pathname === '/v1/owner/changes' && request.method === 'POST')
      return ownerChange(request, env)
    if (pathname === '/v1/owner/reports' && request.method === 'POST')
      return ownerReport(request, env)
  }
  if (pathname.startsWith('/v1/admin/')) {
    if (!bearer(request, env.ADMIN_TOKEN))
      return json({ error: 'unauthorized' }, 401)
    if (pathname === '/v1/admin/owner-prices' && request.method === 'GET')
      return ownerPrices(env)
    if (pathname === '/v1/admin/suggestions' && request.method === 'GET')
      return pending(env)
    if (pathname === '/v1/admin/resolve' && request.method === 'POST')
      return resolve(request, env)
    if (pathname === '/v1/admin/reports' && request.method === 'GET')
      return pendingReports(env)
    if (pathname === '/v1/admin/reports/resolve' && request.method === 'POST')
      return resolveReports(request, env)
    if (pathname === '/v1/admin/sun' && request.method === 'GET')
      return pendingSun(env)
    if (pathname === '/v1/admin/sun/accepted' && request.method === 'GET')
      return acceptedSunReports(env)
    if (pathname === '/v1/admin/sun/resolve' && request.method === 'POST')
      return resolveSun(request, env)
    if (pathname === '/v1/admin/stats' && request.method === 'GET')
      return stats(request, env)
  }
  return json({ error: 'not found' }, 404)
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const origin = allowedOrigin(
      request.headers.get('Origin'),
      env.ALLOWED_ORIGINS,
    )
    const cors: Record<string, string> = origin
      ? {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          Vary: 'Origin',
        }
      : {}
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: cors })
    let response: Response
    try {
      response = await route(request, env, ctx)
    } catch (error) {
      console.error(error)
      response = json({ error: 'server error' }, 500)
    }
    for (const [name, value] of Object.entries(cors))
      response.headers.set(name, value)
    return response
  },
} satisfies ExportedHandler<Env>

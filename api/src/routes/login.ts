import type { Env } from '../env.ts'
import { identity, ipSalt } from '../guard.ts'
import { json, jsonBody } from '../http.ts'
import {
  LOGIN_HOURLY_LIMIT,
  LOGIN_NETWORK_LIMIT,
  LOGIN_WINDOW_MINUTES,
  safeEqual,
} from '../logic.ts'

/**
 * POST /v1/login: the owner's username and password (secrets OWNER_USERNAME
 * and OWNER_PASSWORD) for the owner token, which the app keeps in the
 * browser. Each attempt takes a slot first, in one statement, so parallel
 * guesses can't slip past the limits; a good login gives its network's slots
 * back. Answers 401 the same way for a wrong username or password.
 */
export async function login(request: Request, env: Env): Promise<Response> {
  const salt = ipSalt(env)
  if (typeof salt !== 'string') return salt
  if (!env.OWNER_USERNAME || !env.OWNER_PASSWORD || !env.OWNER_TOKEN)
    return json({ error: 'not configured' }, 503)
  const read = await jsonBody(request)
  if (read instanceof Response) return read
  const body = read.body
  if (typeof body !== 'object' || body === null)
    return json({ error: 'invalid body' }, 400)
  const { username, password } = body as Record<string, unknown>
  if (typeof username !== 'string' || typeof password !== 'string')
    return json({ error: 'invalid body' }, 400)

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const { netHash } = await identity(salt, ip)
  const now = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  const [taken] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO login_attempts (net_hash, at)
       SELECT ?1, ?2
       WHERE (SELECT COUNT(*) FROM login_attempts WHERE net_hash = ?1 AND at >= ?3) < ?4
         AND (SELECT COUNT(*) FROM login_attempts WHERE at >= ?5) < ?6`,
    ).bind(
      netHash,
      iso(now),
      iso(now - LOGIN_WINDOW_MINUTES * 60_000),
      LOGIN_NETWORK_LIMIT,
      iso(now - 3600_000),
      LOGIN_HOURLY_LIMIT,
    ),
    env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(
      iso(now - 86400_000),
    ),
  ])
  if (!taken?.meta.changes)
    return json({ error: 'too many attempts' }, 429, {
      'Retry-After': String(LOGIN_WINDOW_MINUTES * 60),
    })

  // Both compared every time, so the answer doesn't tell which was wrong.
  const userOk = safeEqual(username, env.OWNER_USERNAME)
  const passwordOk = safeEqual(password, env.OWNER_PASSWORD)
  if (!(userOk && passwordOk)) return json({ error: 'wrong login' }, 401)
  await env.DB.prepare('DELETE FROM login_attempts WHERE net_hash = ?')
    .bind(netHash)
    .run()
  return json({ token: env.OWNER_TOKEN }, 200)
}

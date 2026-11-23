/**
 * The admin's per-run token for LAN mode (`npm run admin:lan`). Bound to a
 * non-loopback address, the dev server rejects every `/__admin/*` request
 * without it. The page gets it once from the printed URL (`?token=`), keeps
 * it in sessionStorage and sends it as a header. Pure: shared by the admin
 * page and its dev-server endpoints.
 */
export const TOKEN_HEADER = 'x-admin-token'
export const TOKEN_PARAM = 'token'
const STORAGE_KEY = 'solycerveza-admin-token'

/** Vite's `server.host`: unset or false means localhost; true means every address. */
export function isLoopbackHost(host: string | boolean | undefined): boolean {
  if (host === undefined || host === false) return true
  if (host === true) return false
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  return (
    name === 'localhost' || name === '::1' || /^127(\.\d{1,3}){3}$/.test(name)
  )
}

/** 128 random bits, URL-safe. */
export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Whether a request may pass. `expected` is null in localhost mode, where
 * nothing is required. Compares in constant time.
 */
export function tokenAccepted(
  expected: string | null,
  given: string | readonly string[] | undefined,
): boolean {
  if (expected === null) return true
  if (typeof given !== 'string' || given.length !== expected.length)
    return false
  let diff = 0
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

type TokenStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * The token from the page URL, else from sessionStorage (a reload after the
 * URL was cleaned). A token in the URL is stored for the rest of the tab's life.
 */
export function pageToken(
  search: string,
  storage: TokenStorage,
): string | null {
  const fromUrl = new URLSearchParams(search).get(TOKEN_PARAM)
  try {
    if (fromUrl) {
      storage.setItem(STORAGE_KEY, fromUrl)
      return fromUrl
    }
    return storage.getItem(STORAGE_KEY)
  } catch {
    return fromUrl
  }
}

type Fetch = typeof fetch

function isAdminRequest(input: Parameters<Fetch>[0], origin: string): boolean {
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const url = new URL(href, origin)
  return url.origin === origin && url.pathname.startsWith('/__admin/')
}

/** `fetch`, adding the token header to same-origin `/__admin/` requests only. */
export function withAdminToken(base: Fetch, token: string, origin: string) {
  return (
    input: Parameters<Fetch>[0],
    init?: Parameters<Fetch>[1],
  ): ReturnType<Fetch> => {
    if (!isAdminRequest(input, origin)) return base(input, init)
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    )
    headers.set(TOKEN_HEADER, token)
    return base(input, { ...init, headers })
  }
}

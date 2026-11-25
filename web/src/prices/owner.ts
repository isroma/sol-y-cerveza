import { useSyncExternalStore } from 'react'
import { CAN_SEND, PRICES_API, type SuggestResult } from '../apiClient.ts'

/**
 * Owner mode (ADR-0005, "Owner mode"): the owner uses the visitor's forms,
 * but what they send is a change, not a suggestion. A private link
 * `#owner=<token>` turns it on; the token stays in this browser's
 * localStorage. A price shows at once; a move, closure or new venue is applied
 * by the admin at its next Publish, without review.
 */

const STORAGE_KEY = 'sol-y-cerveza-owner'

type State = {
  token: string | null
  /** A one-line notice in the header ("Enlace de dueño no válido."). */
  message: string | null
}

let state: State = { token: readStored(), message: null }
const listeners = new Set<() => void>()

function set(patch: Partial<State>) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function store(token: string | null) {
  try {
    if (token) window.localStorage.setItem(STORAGE_KEY, token)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Private mode: owner mode lasts until the tab closes.
  }
}

export function useOwner(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

/** Whether the change forms can send: a visitor's build needs the bot check, the owner only the API. */
export function useCanSend(): boolean {
  const { token } = useOwner()
  return CAN_SEND || (token !== null && PRICES_API !== null)
}

/** The token in `#owner=<token>`, or null. */
export function tokenFromHash(hash: string): string | null {
  const match = /^#owner=([A-Za-z0-9_-]{16,})$/.exec(hash)
  return match?.[1] ?? null
}

async function call(
  path: string,
  init: RequestInit,
  token: string,
): Promise<Response> {
  if (!PRICES_API) throw new Error('no API')
  return fetch(`${PRICES_API}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
}

/** Turns owner mode on from the link (and removes the token from the address bar). */
export async function unlockFromLocation(): Promise<void> {
  const token = tokenFromHash(window.location.hash)
  if (!token) return
  history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  )
  const ok = await call('/v1/owner/check', { method: 'GET' }, token)
    .then((r) => r.ok)
    .catch(() => false)
  if (!ok) return set({ message: 'Enlace de dueño no válido.' })
  store(token)
  set({ token, message: null })
}

export function exitOwner() {
  store(null)
  set({ token: null, message: null })
}

export function dismissMessage() {
  set({ message: null })
}

/** POSTs the owner's change (`/v1/owner/changes` or `/v1/owner/reports`); never throws. */
export async function ownerPost(
  path: '/v1/owner/changes' | '/v1/owner/reports',
  body: unknown,
): Promise<SuggestResult> {
  if (!state.token) return 'error'
  try {
    const response = await call(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      state.token,
    )
    return response.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

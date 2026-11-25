import { useSyncExternalStore } from 'react'
import { CAN_SEND, PRICES_API, type SuggestResult } from '../apiClient.ts'

/**
 * Owner mode (ADR-0005, "Owner mode"), shown as "Admin": the owner uses the
 * visitor's forms, but what they send is a change, not a suggestion. They log
 * in at /admin with a username and password; the API answers with the owner
 * token, which stays in this browser's localStorage until they log out. A
 * price shows at once; a move, closure or new venue is applied by the admin at
 * its next Publish, without review.
 */

const STORAGE_KEY = 'sol-y-cerveza-owner'

type State = { token: string | null }

let state: State = { token: readStored() }
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

export type LoginResult = 'ok' | 'wrong' | 'too-many' | 'error'

/** Logs in with the owner's username and password; never throws. */
export async function logIn(
  username: string,
  password: string,
): Promise<LoginResult> {
  if (!PRICES_API) return 'error'
  try {
    const response = await fetch(`${PRICES_API}/v1/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
    if (response.status === 401) return 'wrong'
    if (response.status === 429) return 'too-many'
    if (!response.ok) return 'error'
    const body: unknown = await response.json()
    const token =
      typeof body === 'object' && body !== null && 'token' in body
        ? body.token
        : null
    if (typeof token !== 'string' || token === '') return 'error'
    store(token)
    set({ token })
    return 'ok'
  } catch {
    return 'error'
  }
}

export function logOut() {
  store(null)
  set({ token: null })
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

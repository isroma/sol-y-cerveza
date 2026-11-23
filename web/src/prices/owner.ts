import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { BRANDS, ITEMS, type Brand, type Item } from '../data/prices.ts'
import type { LatLon } from '../data/terraces.ts'
import { PRICES_API } from './crowd.ts'

/**
 * Owner mode: the owner saves confirmed beer prices from their phone, straight
 * to the API (ADR-0005, "Owner mode"). A private link `#owner=<token>` turns it
 * on; the token stays in this browser's localStorage. It can only add or
 * remove prices.
 */

const STORAGE_KEY = 'sol-y-cerveza-owner'

export type OwnerProposal = {
  item: Item
  brand: Brand | null
  cents: number
  label: string
  confidence: 'high' | 'low'
}

type State = {
  token: string | null
  /** Prices read from a photo that wait for a tap, per venue id. */
  pending: ReadonlyMap<string, readonly OwnerProposal[]>
  /** A one-line message for the owner bar ("Guardado en …"). */
  message: string | null
}

let state: State = { token: readStored(), pending: new Map(), message: null }
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
  set({ token, message: 'Modo dueño activado.' })
}

export function exitOwner() {
  store(null)
  set({ token: null, pending: new Map(), message: null })
}

export function showMessage(message: string | null) {
  set({ message })
}

export function setPending(
  venueId: string,
  proposals: readonly OwnerProposal[],
) {
  const pending = new Map(state.pending)
  if (proposals.length) pending.set(venueId, proposals)
  else pending.delete(venueId)
  set({ pending })
}

export async function saveOwnerPrice(price: {
  venueId: string
  item: Item
  brand: Brand | null
  cents: number
}): Promise<boolean> {
  if (!state.token) return false
  return call(
    '/v1/owner/prices',
    { method: 'PUT', body: JSON.stringify(price) },
    state.token,
  )
    .then((r) => r.ok)
    .catch(() => false)
}

export async function removeOwnerPrice(price: {
  venueId: string
  item: Item
  brand: Brand | null
}): Promise<boolean> {
  if (!state.token) return false
  return call(
    '/v1/owner/prices',
    // The API validates the whole price; cents is ignored when deleting.
    { method: 'DELETE', body: JSON.stringify({ ...price, cents: 100 }) },
    state.token,
  )
    .then((r) => r.ok)
    .catch(() => false)
}

const photoAnswer = z.union([
  z.object({
    proposals: z.array(
      z.object({
        item: z.enum(ITEMS),
        brand: z.enum(BRANDS).nullable(),
        cents: z.number().int(),
        label: z.string(),
        confidence: z.enum(['high', 'low']),
      }),
    ),
    notes: z.array(z.string()),
    barName: z.string().nullable(),
  }),
  z.object({ error: z.string() }),
])

export type OwnerPhotoReading = {
  proposals: OwnerProposal[]
  notes: string[]
  barName: string | null
}

export async function readOwnerPhoto(photo: {
  image: string
  mediaType: 'image/jpeg'
}): Promise<OwnerPhotoReading | { error: string }> {
  if (!state.token) return { error: 'Modo dueño desactivado.' }
  try {
    const response = await call(
      '/v1/owner/photo',
      { method: 'POST', body: JSON.stringify(photo) },
      state.token,
    )
    const parsed = photoAnswer.safeParse(await response.json())
    if (!parsed.success) return { error: 'Respuesta inesperada.' }
    return parsed.data
  } catch {
    return { error: 'No se ha podido leer la foto. Inténtalo de nuevo.' }
  }
}

// --- Which bar a photo is from ---------------------------------------------

/** Metres between two points (equirectangular: fine at bar distances). */
export function distanceM(a: LatLon, b: LatLon): number {
  const k = 111_320
  const dx =
    (a.lon - b.lon) * k * Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const dy = (a.lat - b.lat) * k
  return Math.hypot(dx, dy)
}

const GENERIC = new Set([
  'bar',
  'cafe',
  'cafeteria',
  'restaurante',
  'cerveceria',
  'taberna',
  'meson',
  'el',
  'la',
  'los',
  'las',
  'de',
  'del',
  'y',
])

function words(name: string): string[] {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !GENERIC.has(w))
}

/** Whether the name on a menu and a venue's name are the same bar. */
export function nameMatches(read: string, venue: string): boolean {
  const a = words(read)
  const b = words(venue)
  if (!a.length || !b.length) return false
  const shared = a.filter((w) => b.includes(w)).length
  return shared / Math.min(a.length, b.length) >= 0.5
}

/** A photo taken farther than this from the bar is probably from elsewhere. */
export const PHOTO_NEAR_M = 75
/** Bars within this of the photo are candidates when no card is open. */
export const CANDIDATE_M = 120
/** One bar within this of the photo, with no other, is a sure match. */
export const SURE_M = 25

export type VenueRef = { id: string; name: string; at: LatLon }

/** Why a photo may not be from the open card's bar, or null when it fits. */
export function photoDoubt(
  venue: VenueRef,
  photoAt: LatLon | null,
  barName: string | null,
): string | null {
  if (photoAt) {
    const d = distanceM(photoAt, venue.at)
    if (d > PHOTO_NEAR_M)
      return `La foto se hizo a ${Math.round(d)} m de ${venue.name}.`
  }
  if (barName && !nameMatches(barName, venue.name))
    return `La carta dice «${barName}».`
  return null
}

/**
 * The bar a photo is from, when no card is open: the one whose name is on the
 * menu, or the only bar right next to where it was taken. Otherwise the
 * nearest bars (or those with that name) to choose from.
 */
export function pickVenue(
  venues: readonly VenueRef[],
  photoAt: LatLon | null,
  barName: string | null,
): { sure: VenueRef | null; options: VenueRef[] } {
  const near = photoAt
    ? venues
        .map((v) => ({ v, d: distanceM(photoAt, v.at) }))
        .filter((x) => x.d <= CANDIDATE_M)
        .sort((a, b) => a.d - b.d)
    : []
  if (barName) {
    const pool = near.length ? near.map((x) => x.v) : venues
    const named = pool.filter((v) => nameMatches(barName, v.name))
    if (named.length === 1 && named[0])
      return { sure: named[0], options: named }
    if (named.length > 1) return { sure: null, options: named.slice(0, 6) }
  }
  const close = near.filter((x) => x.d <= SURE_M)
  if (close.length === 1 && close[0])
    return { sure: close[0].v, options: [close[0].v] }
  return { sure: null, options: near.slice(0, 6).map((x) => x.v) }
}

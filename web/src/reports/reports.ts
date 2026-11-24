import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Brand, Item } from '../data/prices.ts'
import {
  PRICES_API,
  TURNSTILE_SITE_KEY,
  type SuggestResult,
} from '../prices/crowd.ts'

/**
 * Visitors' reports of a moved, closed or missing venue (issue #201). They go
 * to the same API as price suggestions and wait for the owner's review, so
 * nothing changes on the map when one is sent.
 */

/** Shown only when the build has the API and the bot check, like price suggestions. */
export const CAN_REPORT = PRICES_API !== null && TURNSTILE_SITE_KEY !== null

/** The box the API accepts positions in. */
const BADAJOZ = { south: 38.84, west: -7.04, north: 38.92, east: -6.92 }

/** The API refuses moves further than this from the published position. */
export const MAX_MOVE_M = 500
/** Below this, the pin hasn't really moved. */
export const MIN_MOVE_M = 5

export type AddKind = Exclude<Terrace['kind'], 'biergarten'>

export type Report =
  | { kind: 'move'; venueId: string; lat: number; lon: number; token: string }
  | { kind: 'closed'; venueId: string; token: string }
  | {
      kind: 'add'
      name: string
      venueKind: AddKind
      terrace: boolean
      lat: number
      lon: number
      token: string
    }

/** As the API cleans it: commas, quotes and line breaks become spaces, whitespace collapsed. */
export function cleanName(raw: string): string {
  return raw
    .replace(/[,"'“”‘’«»\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 2 to 60 characters after cleaning, and no links. */
export function validName(raw: string): boolean {
  const name = cleanName(raw)
  return name.length >= 2 && name.length <= 60 && !/http|www/i.test(name)
}

export function insideBadajoz({ lat, lon }: LatLon): boolean {
  return (
    lat >= BADAJOZ.south &&
    lat <= BADAJOZ.north &&
    lon >= BADAJOZ.west &&
    lon <= BADAJOZ.east
  )
}

/** Great-circle distance in metres (haversine). */
export function distanceMetres(a: LatLon, b: LatLon): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

export async function reportVenue(report: Report): Promise<SuggestResult> {
  if (!PRICES_API) return 'error'
  const body =
    report.kind === 'closed'
      ? report
      : { ...report, lat: round6(report.lat), lon: round6(report.lon) }
  try {
    const response = await fetch(`${PRICES_API}/v1/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return 'ok'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return 'bot'
    return 'error'
  } catch {
    return 'error'
  }
}

export const RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo revisaremos antes de publicarlo.',
  'rate-limited':
    'Hay demasiados avisos enviados desde tu conexión. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

/** Everything a visitor suggests from a card's back, behind one bot check. */
export type Change = {
  venueId: string
  token: string
  price?: { item: Item; brand: Brand | null; cents: number }
  move?: LatLon
  closed?: true
}

export async function sendChange(change: Change): Promise<SuggestResult> {
  if (!PRICES_API) return 'error'
  const body = change.move
    ? {
        ...change,
        move: { lat: round6(change.move.lat), lon: round6(change.move.lon) },
      }
    : change
  try {
    const response = await fetch(`${PRICES_API}/v1/changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.ok) return 'ok'
    if (response.status === 429) return 'rate-limited'
    if (response.status === 403) return 'bot'
    return 'error'
  } catch {
    return 'error'
  }
}

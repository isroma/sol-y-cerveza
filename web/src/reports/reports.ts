import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Brand, Item } from '../data/prices.ts'
import { cleanVenueName } from '../data/geo.ts'
import { postJson, type SuggestResult } from '../apiClient.ts'
import { ownerPost } from '../prices/owner.ts'

/**
 * Visitors' reports of a moved, closed or missing venue (issue #201). They go
 * to the same API as price suggestions and wait for the owner's review, so
 * nothing changes on the map when one is sent.
 */

/** The API refuses moves further than this from the published position. */
export const MAX_MOVE_M = 500
/**
 * The API refuses a terrace's tables marked further than this from the
 * published venue position (MAX_PIN_METRES in api/src/reports.ts).
 */
export const MAX_PIN_M = 150
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

/** 2 to 60 characters after cleaning, and no links. */
export function validName(raw: string): boolean {
  const name = cleanVenueName(raw)
  return name.length >= 2 && name.length <= 60 && !/http|www/i.test(name)
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

export function reportVenue(report: Report): Promise<SuggestResult> {
  const body =
    report.kind === 'closed'
      ? report
      : { ...report, lat: round6(report.lat), lon: round6(report.lon) }
  return postJson('/v1/reports', body)
}

/** A new venue from the owner: no bot check, added at the admin's next Publish. */
export function ownerAddVenue(
  report: Omit<Extract<Report, { kind: 'add' }>, 'token'>,
): Promise<SuggestResult> {
  return ownerPost('/v1/owner/reports', {
    ...report,
    lat: round6(report.lat),
    lon: round6(report.lon),
  })
}

/** What the owner sees after saving a change or adding a venue. */
export const OWNER_RESULT_TEXT = {
  price: 'Guardado. El precio ya se ve en el mapa.',
  sun: 'Guardado. El sol ya se ve en el mapa.',
  now: 'Guardado. Ya se ve en el mapa.',
  later: 'Guardado. Se aplicará en la próxima publicación.',
  shade: 'Guardado. La sombra ya se ve en el mapa.',
  notSunny:
    'Ahora no luce el sol en Badajoz, así que la sombra no cuenta. Prueba con el cielo despejado.',
  error: 'No se ha podido guardar. Inténtalo de nuevo.',
}

export const RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo revisaremos antes de publicarlo.',
  'rate-limited':
    'Hay demasiados avisos enviados desde tu conexión. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  'not-sunny':
    'Ahora no luce el sol en Badajoz, así que la sombra no cuenta. Prueba con el cielo despejado.',
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

/** What a visitor sees after sending only a price. */
export const PRICE_RESULT_TEXT: Record<SuggestResult, string> = {
  ok: '¡Gracias! Lo mostraremos cuando varias personas coincidan.',
  'rate-limited':
    'Hay demasiados precios enviados desde tu conexión o para este bar. Prueba más tarde.',
  bot: 'No hemos podido verificar que no eres un robot. Inténtalo de nuevo.',
  'not-sunny': RESULT_TEXT['not-sunny'],
  error: 'No se ha podido enviar. Inténtalo más tarde.',
}

/**
 * What a visitor sees after saying only that the sun is here now: it shows
 * once 3 networks agree (SUN_THRESHOLD in the API).
 */
export const SUN_RESULT_TEXT: Record<SuggestResult, string> = {
  ...RESULT_TEXT,
  ok: '¡Gracias! Marcaremos el sol cuando tres personas coincidan.',
}

/** What a visitor sees after saying only that the terrace is in shade now (ADR-0014). */
export const SHADE_RESULT_TEXT: Record<SuggestResult, string> = {
  ...RESULT_TEXT,
  ok: '¡Gracias! Marcaremos la sombra cuando tres personas coincidan.',
}

/** Everything a visitor suggests from a card's back, behind one bot check. */
export type Change = {
  venueId: string
  token: string
  price?: { item: Item; brand: Brand | null; cents: number }
  move?: LatLon
  closed?: true
  /** The sun is on the terrace now; the API stamps the time and the sun's place. */
  sun?: true
  /** The terrace is in shade now, with the sun out (ADR-0014); never with `sun`. */
  shade?: true
  /** Whether the venue has a terrace (ADR-0009); reviewed like a move. */
  terrace?: boolean
  /** Where its tables are; never with `terrace: false` (the API refuses it). */
  pin?: LatLon
}

const roundSpot = (spot: LatLon): LatLon => ({
  lat: round6(spot.lat),
  lon: round6(spot.lon),
})

function rounded<T extends { move?: LatLon; pin?: LatLon }>(change: T): T {
  return {
    ...change,
    ...(change.move ? { move: roundSpot(change.move) } : {}),
    ...(change.pin ? { pin: roundSpot(change.pin) } : {}),
  }
}

export function sendChange(change: Change): Promise<SuggestResult> {
  return postJson('/v1/changes', rounded(change))
}

/** The card back in owner mode: a change, not a suggestion, with no bot check. */
export function sendOwnerChange(
  change: Omit<Change, 'token'>,
): Promise<SuggestResult> {
  return ownerPost('/v1/owner/changes', rounded(change))
}

/**
 * The anonymous usage counters' allowlist (ADR-0013), shared by the app and the
 * API Worker (api/src imports this file, as it does geo.ts). Keep it free
 * of zod and the DOM, so the Worker bundle stays small.
 *
 * Each event name has a fixed set of values, none (`[]`), or `'venue'`: a venue
 * id the Worker accepts only when it is in the published data. Nothing else is
 * ever counted, so the API's table stays small whatever anyone sends.
 */

/** The filters' keys (`Filters` in filters/filters.ts; telemetry.test.tsx keeps them equal). */
export const FILTER_KEYS = ['sunNow', 'onlyTerrace'] as const

/** The hours of the day as the app shows them, Madrid time: "00" … "23". */
export const HOURS: readonly string[] = Array.from({ length: 24 }, (_, h) =>
  String(h).padStart(2, '0'),
)

export const EVENTS = {
  /** A page load, by the app's layout (the 900 px breakpoint). */
  open: ['phone', 'desktop'],
  /** A venue card opened, however (map, list, link). */
  venue_open: 'venue',
  /** A card turned to its back ("Sugerir un cambio"). */
  card_back: [],
  /** The time slider came to rest on an hour. */
  time_change: HOURS,
  /** A filter switched on. */
  filter: FILTER_KEYS,
  /** The search box typed in, once per page load. Never the text. */
  search: [],
  /** The locate control tapped. Never the position or the permission. */
  locate: [],
  /** "¿Falta un bar? Añádelo" opened. */
  add_open: [],
  /** A card-back change sent and accepted by the API. */
  suggest_sent: [],
  /** A sun report sent and accepted by the API. */
  sun_report: [],
} as const satisfies Record<string, readonly string[] | 'venue'>

export type EventName = keyof typeof EVENTS

/** The value an event takes: a venue id, one of its values, or none. */
export type EventValue<N extends EventName> = (typeof EVENTS)[N] extends 'venue'
  ? string
  : (typeof EVENTS)[N] extends readonly []
    ? undefined
    : Exclude<(typeof EVENTS)[N], 'venue'>[number]

/** The most events in one POST /v1/events. */
export const MAX_EVENTS = 20

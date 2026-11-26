/**
 * Pure rules of the anonymous usage counters (ADR-0013): which events a
 * POST /v1/events may count. The allowlist is the app's own
 * (web/src/data/telemetryEvents.ts), so the two can't drift apart.
 */
import { madridDate } from './logic.ts'
import {
  EVENTS,
  MAX_EVENTS,
  type EventName,
} from '../../web/src/data/telemetryEvents.ts'

export { MAX_EVENTS }

/** The largest POST /v1/events body, in bytes: 20 events with long venue ids fit easily. */
export const EVENTS_MAX_BODY = 4 * 1024

/**
 * The most days GET /v1/admin/stats returns (at most about 700 rows a day),
 * and the default. Longer ranges are a `wrangler d1 execute` query.
 */
export const STATS_MAX_DAYS = 90
export const STATS_DEFAULT_DAYS = 30

/** One event as the app sends it, not yet checked. */
export type RawEvent = { name: string; value: string }

/** One counter to add to: a day's (name, value) and by how much. */
export type Count = { name: string; value: string; count: number }

function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENTS, name)
}

/**
 * The body's events, or null when the body is malformed: not `{events: [...]}`
 * or more than MAX_EVENTS of them. Entries that aren't `{name, value?}` with
 * strings are dropped here; names and values are checked by `allowed`.
 */
export function parseEvents(body: unknown): RawEvent[] | null {
  if (typeof body !== 'object' || body === null || !('events' in body))
    return null
  const { events } = body
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return null
  const parsed: RawEvent[] = []
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const name: unknown = 'name' in event ? event.name : undefined
    const value: unknown = 'value' in event ? event.value : undefined
    if (typeof name !== 'string') continue
    if (value !== undefined && typeof value !== 'string') continue
    parsed.push({ name, value: value ?? '' })
  }
  return parsed
}

/** Whether an event needs a venue id checked against the published data. */
export function needsVenue(event: RawEvent): boolean {
  return isEventName(event.name) && EVENTS[event.name] === 'venue'
}

/**
 * Whether the event is on the allowlist with an allowed value; a venue event
 * only with a venue `isVenue` knows (the published data).
 */
export function allowed(
  event: RawEvent,
  isVenue: (id: string) => boolean,
): boolean {
  if (!isEventName(event.name)) return false
  const values: readonly string[] | 'venue' = EVENTS[event.name]
  if (values === 'venue') return event.value !== '' && isVenue(event.value)
  if (values.length === 0) return event.value === ''
  return values.includes(event.value)
}

/** The allowed events, one counter per (name, value) with duplicates added up, in a stable order. */
export function countEvents(
  events: readonly RawEvent[],
  isVenue: (id: string) => boolean,
): Count[] {
  const counts = new Map<string, Count>()
  for (const event of events) {
    if (!allowed(event, isVenue)) continue
    const key = JSON.stringify([event.name, event.value])
    const count = counts.get(key)
    if (count) count.count++
    else counts.set(key, { name: event.name, value: event.value, count: 1 })
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en') ||
      a.value.localeCompare(b.value, 'en'),
  )
}

/** GET /v1/admin/stats's `days`: a whole number from 1 to STATS_MAX_DAYS, else the default. */
export function statsDays(param: string | null): number {
  if (param === null || !/^\d+$/.test(param)) return STATS_DEFAULT_DAYS
  const days = Number(param)
  if (days < 1) return STATS_DEFAULT_DAYS
  return Math.min(days, STATS_MAX_DAYS)
}

/** The first Madrid date of the last `days` days, today included. */
export function statsSince(now: Date, days: number): string {
  const today = new Date(`${madridDate(now)}T00:00:00Z`)
  return new Date(today.getTime() - (days - 1) * 86400_000)
    .toISOString()
    .slice(0, 10)
}

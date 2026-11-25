import * as z from 'zod/mini'
import { formatClock, parseClock } from './time/madrid.ts'

/**
 * What a link carries: the time today in Madrid (null while it follows the
 * clock) and the selected venue.
 */
export type ViewState = {
  time: number | null
  venue: string | null
}

const venueId = z.string().check(z.regex(/^[\w:./-]{1,200}$/))

/** A query string that keeps ":" and "/" readable (both are legal there). */
function toSearch(params: URLSearchParams): string {
  const query = params.toString().replace(/%3A/gi, ':').replace(/%2F/gi, '/')
  return query === '' ? '' : `?${query}`
}

/** The view a query string asks for; bad values are ignored. */
export function readUrlState(search: string): ViewState {
  const params = new URLSearchParams(search)
  const t = params.get('t')
  const v = venueId.safeParse(params.get('v'))
  return {
    time: t === null ? null : parseClock(t),
    venue: v.success ? v.data : null,
  }
}

/**
 * The view to start with: the link's, except that a reload starts at the
 * current time (the time in the address is the one picked before it).
 */
export function startState(search: string, reloaded: boolean): ViewState {
  const state = readUrlState(search)
  return reloaded ? { ...state, time: null } : state
}

/** Whether this page load is a reload, not a link or typed address. */
export function wasReloaded(): boolean {
  // Without Navigation Timing (old browsers, tests), a first load.
  const [entry] = performance.getEntriesByType?.('navigation') ?? []
  return !!entry && 'type' in entry && entry.type === 'reload'
}

/**
 * `search` with t and v set from `state` (and dropped when they hold the
 * default), keeping any other parameters. Returns "" or "?…".
 */
export function writeUrlState(search: string, state: ViewState): string {
  const params = new URLSearchParams(search)
  const set = (key: string, value: string | null) => {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  set('t', state.time === null ? null : formatClock(state.time))
  set('v', state.venue)
  return toSearch(params)
}

/**
 * The link to share a venue: the current page with the venue and the time
 * pinned, so whoever opens it sees the sun the sender is talking about.
 */
export function shareUrl(href: string, venue: string, minutes: number): string {
  const url = new URL(href)
  const params = new URLSearchParams(url.search)
  params.set('t', formatClock(minutes))
  params.set('v', venue)
  url.search = toSearch(params)
  url.hash = ''
  return url.toString()
}

/**
 * Anonymous usage counters (ADR-0013): `track('filter', 'sunNow')` adds one to
 * today's counter for that event on the API (POST /v1/events). Events wait in
 * memory and go in one request a few seconds later, when MAX_EVENTS are
 * waiting, or when the page is hidden. Nothing identifies the visitor: no
 * cookie, no storage, no id, no referrer; only allowlisted names and values
 * (data/telemetryEvents.ts).
 *
 * It does nothing until `startTelemetry()` (called by the visitor app's
 * main.tsx only, so never in the admin or in tests that don't ask), without an
 * API (`PRICES_API`), when the browser sends Global Privacy Control or Do Not
 * Track, and in owner mode. It never throws, never retries and never makes a
 * caller wait.
 */
import { PRICES_API } from './apiClient.ts'
import { isOwner } from './prices/owner.ts'
import {
  MAX_EVENTS,
  type EventName,
  type EventValue,
} from './data/telemetryEvents.ts'

/** How long events wait for others before they're sent together. */
export const FLUSH_DELAY_MS = 5_000
/** How long a `trackSettled` event waits for the visitor to stop changing it. */
export const SETTLE_MS = 1_500
/** The app's phone layout (App.tsx). */
const PHONE_QUERY = '(max-width: 899px)'

/** `track`'s value argument: required for events that take one, absent otherwise. */
type ValueArg<N extends EventName> =
  EventValue<N> extends undefined ? [] : [value: EventValue<N>]

type Queued = { name: EventName; value?: string }

let started = false
let queue: Queued[] = []
let flushTimer: number | undefined
const tracked = new Set<EventName>()
const settling = new Map<EventName, { timer: number; run: () => void }>()

/** The browser asks not to be tracked (GPC, or the older DNT). */
function optedOut(): boolean {
  const nav: Navigator & {
    globalPrivacyControl?: boolean
    doNotTrack?: string | null
  } = navigator
  return nav.globalPrivacyControl === true || nav.doNotTrack === '1'
}

function enabled(): boolean {
  return started && PRICES_API !== null && !optedOut() && !isOwner()
}

/** Counts one event. */
export function track<N extends EventName>(name: N, ...args: ValueArg<N>) {
  try {
    if (!enabled()) return
    const value: unknown = args[0]
    queue.push(typeof value === 'string' ? { name, value } : { name })
    if (queue.length >= MAX_EVENTS) flush()
    else
      flushTimer ??= window.setTimeout(() => {
        flushTimer = undefined
        flush()
      }, FLUSH_DELAY_MS)
  } catch {
    // Counting must never get in the visitor's way.
  }
}

/** Counts the event the first time in this page load only. */
export function trackOnce<N extends EventName>(name: N, ...args: ValueArg<N>) {
  if (tracked.has(name) || !enabled()) return
  tracked.add(name)
  track(name, ...args)
}

/**
 * Counts the event once the visitor stops changing it for SETTLE_MS (a
 * slider being dragged): each call replaces the one still waiting.
 */
export function trackSettled<N extends EventName>(
  name: N,
  ...args: ValueArg<N>
) {
  try {
    const waiting = settling.get(name)
    if (waiting) window.clearTimeout(waiting.timer)
    const run = () => {
      settling.delete(name)
      track(name, ...args)
    }
    settling.set(name, { timer: window.setTimeout(run, SETTLE_MS), run })
  } catch {
    // As track.
  }
}

/** Sends what is waiting, in one request; failures are dropped. */
export function flush() {
  if (flushTimer !== undefined) window.clearTimeout(flushTimer)
  flushTimer = undefined
  const events = queue
  queue = []
  if (events.length === 0 || PRICES_API === null) return
  try {
    // text/plain, so the browser sends it without a CORS preflight; keepalive,
    // so it still goes as the page unloads.
    void fetch(`${PRICES_API}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ events }),
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    }).catch(() => {})
  } catch {
    // As track.
  }
}

/** Counts this page load and sends what is waiting when the page is hidden. */
export function startTelemetry() {
  if (started) return
  started = true
  const hidden = () => {
    for (const { timer, run } of [...settling.values()]) {
      window.clearTimeout(timer)
      run()
    }
    flush()
  }
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') hidden()
    })
    window.addEventListener('pagehide', hidden)
    const phone =
      typeof window.matchMedia === 'function' &&
      window.matchMedia(PHONE_QUERY).matches
    track('open', phone ? 'phone' : 'desktop')
  } catch {
    // As track.
  }
}

import { isDateString, parseClock } from './time/madrid.ts'

/**
 * Shareable view state in the URL: `?fecha=2026-06-21&hora=14:00`.
 * Only read at start-up and rewritten with replaceState, so it never adds
 * history entries.
 */
export type UrlState = { date: string | null; minutes: number | null }

export function readUrlState(search: string): UrlState {
  const params = new URLSearchParams(search)
  const date = params.get('fecha')
  const clock = params.get('hora')
  return {
    date: date !== null && isDateString(date) ? date : null,
    minutes: clock === null ? null : parseClock(clock),
  }
}

export function writeUrlState(date: string, clock: string): string {
  const params = new URLSearchParams(window.location.search)
  params.set('fecha', date)
  params.set('hora', clock)
  return `${window.location.pathname}?${params.toString()}${window.location.hash}`
}

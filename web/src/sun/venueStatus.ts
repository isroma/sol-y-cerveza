import type { Terrace } from '../data/terraces.ts'
import { MINUTES_PER_DAY } from '../time/madrid.ts'
import { stepIndex, type DayTrack } from './dayTrack.ts'
import { horizonFor } from './leafOff.ts'
import { STEP_MINUTES, sunState, type SunState } from './sunState.ts'

/** How a venue is drawn: sunny now, sunny within SOON_MINUTES, no sun, or unknown. */
export type SunCategory = 'sun' | 'soon' | 'nosun' | 'unknown'

export const SOON_MINUTES = 60

/**
 * A venue's sun/shade state per step of the day, or null without a horizon.
 * In the leaf-off period it follows the leaf-off horizon (ADR-0007).
 */
export type VenueDay = { venue: Terrace; timeline: SunState[] | null }

export type VenueStatus = {
  venue: Terrace
  hasTerrace: boolean
  /** State at the chosen minute. */
  state: SunState
  category: SunCategory
  /** Per-step states for the whole day (see DayTrack), null without a horizon. */
  timeline: SunState[] | null
  /** While in sun: the minute the sun goes (MINUTES_PER_DAY if it lasts until midnight). */
  sunUntil: number | null
  /** While not in sun: the minute the sun next arrives today, if it does. */
  nextSun: number | null
  /** Minutes of sun from the chosen minute until the end of the day. */
  minutesLeft: number | null
}

export function venueDay(venue: Terrace, track: DayTrack): VenueDay {
  const horizon = horizonFor(venue, track.date)
  if (venue.terrace === null || horizon === null)
    return { venue, timeline: null }
  return {
    venue,
    timeline: track.positions.map((position) => sunState(horizon, position)),
  }
}

function firstIndex(
  timeline: readonly SunState[],
  from: number,
  predicate: (state: SunState) => boolean,
): number | null {
  for (let i = from; i < timeline.length; i++) {
    const state = timeline[i]
    if (state !== undefined && predicate(state)) return i
  }
  return null
}

export function venueStatus(day: VenueDay, minutes: number): VenueStatus {
  const { venue, timeline } = day
  const hasTerrace = venue.terrace !== null
  if (timeline === null) {
    return {
      venue,
      hasTerrace,
      state: 'unknown',
      category: 'unknown',
      timeline: null,
      sunUntil: null,
      nextSun: null,
      minutesLeft: null,
    }
  }

  const index = stepIndex(minutes)
  const state = timeline[index] ?? 'unknown'
  const sunUntil =
    state === 'sun'
      ? (firstIndex(timeline, index, (s) => s !== 'sun') ?? timeline.length) *
        STEP_MINUTES
      : null
  const nextIndex =
    state === 'sun' ? null : firstIndex(timeline, index, (s) => s === 'sun')
  const nextSun = nextIndex === null ? null : nextIndex * STEP_MINUTES
  const minutesLeft =
    timeline.slice(index).filter((s) => s === 'sun').length * STEP_MINUTES

  let category: SunCategory = 'nosun'
  if (state === 'sun') category = 'sun'
  else if (nextSun !== null && nextSun - minutes <= SOON_MINUTES)
    category = 'soon'

  return {
    venue,
    hasTerrace,
    state,
    category,
    timeline,
    sunUntil: sunUntil === null ? null : Math.min(sunUntil, MINUTES_PER_DAY),
    nextSun,
    minutesLeft,
  }
}

const CATEGORY_ORDER: Record<SunCategory, number> = {
  sun: 0,
  soon: 1,
  nosun: 2,
  unknown: 3,
}

/** Sunny first, then sun soon, then by minutes of sun left, then by name. */
export function compareStatus(a: VenueStatus, b: VenueStatus): number {
  return (
    CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] ||
    (b.minutesLeft ?? -1) - (a.minutesLeft ?? -1) ||
    a.venue.name.localeCompare(b.venue.name, 'es')
  )
}

/** Sun-run segments of a timeline, as [startMinute, endMinute) pairs. */
export function sunRuns(timeline: readonly SunState[]): [number, number][] {
  const runs: [number, number][] = []
  let start: number | null = null
  timeline.forEach((state, i) => {
    if (state === 'sun' && start === null) start = i
    if (state !== 'sun' && start !== null) {
      runs.push([start * STEP_MINUTES, i * STEP_MINUTES])
      start = null
    }
  })
  if (start !== null)
    runs.push([start * STEP_MINUTES, timeline.length * STEP_MINUTES])
  return runs
}

/** The sun spell `minutes` falls in, or null in shade or at night. */
export function currentSunRun(
  timeline: readonly SunState[],
  minutes: number,
): [number, number] | null {
  return sunRuns(timeline).find(([a, b]) => a <= minutes && minutes < b) ?? null
}

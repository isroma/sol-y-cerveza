import type { Terrace } from '../data/terraces.ts'
import { MINUTES_PER_DAY } from '../time/madrid.ts'
import { stepIndex, type DayTrack } from './dayTrack.ts'
import { correctHorizon, type SunCorrection } from './corrections.ts'
import { anySunHorizon, horizonFor, isLeafOff } from './leafOff.ts'
import {
  fillShortShade,
  STEP_MINUTES,
  sunState,
  type SunState,
} from './sunState.ts'

/** How a venue is drawn: sunny now, sunny within SOON_MINUTES, no sun, or unknown. */
export type SunCategory = 'sun' | 'soon' | 'nosun' | 'unknown'

export const SOON_MINUTES = 60

/**
 * A venue's sun/shade state per step of the day, or null without a horizon.
 * In the leaf-off period it follows the leaf-off horizon (ADR-0007). Short
 * shade between two sunny stretches counts as sun (`fillShortShade`).
 * Visitors' corrections (`corrections.ts`) add sun; `approximate` marks the
 * steps that are sun only because of unconfirmed ones (null: none are).
 */
export type VenueDay = {
  venue: Terrace
  timeline: SunState[] | null
  approximate: boolean[] | null
}

export type VenueStatus = {
  venue: Terrace
  hasTerrace: boolean
  /** State at the chosen minute. */
  state: SunState
  category: SunCategory
  /** Per-step states for the whole day (see DayTrack), null without a horizon. */
  timeline: SunState[] | null
  /** Per step: sun only thanks to visitors' unconfirmed reports; null if none is. */
  approximate: boolean[] | null
  /**
   * The answer at the chosen minute leans on visitors: the sun spell it talks
   * about (the current one in sun, else the next) has visitor-only steps.
   */
  byVisitors: boolean
  /** While in sun: the minute the sun goes (MINUTES_PER_DAY if it lasts until midnight). */
  sunUntil: number | null
  /** While not in sun: the minute the sun next arrives today, if it does. */
  nextSun: number | null
  /** Minutes of sun from the chosen minute until the end of the day. */
  minutesLeft: number | null
}

function dayStates(horizon: readonly number[], track: DayTrack): SunState[] {
  return fillShortShade(
    track.positions.map((position) => sunState(horizon, position)),
  )
}

/**
 * `corrections` are the venue's own (any season); the cap applies to
 * whichever horizon answers that day (envelope, leaf-off or full).
 */
export function venueDay(
  venue: Terrace,
  track: DayTrack,
  corrections: readonly SunCorrection[] = [],
): VenueDay {
  // Sun when any part of the terrace has it (its envelope), else at the pin.
  const horizon =
    anySunHorizon(venue, track.date) ?? horizonFor(venue, track.date)
  if (venue.terrace === null || horizon === null)
    return { venue, timeline: null, approximate: null }
  const corrected =
    corrections.length > 0
      ? correctHorizon(horizon, corrections, isLeafOff(track.date))
      : null
  if (corrected === null)
    return { venue, timeline: dayStates(horizon, track), approximate: null }
  const timeline = dayStates(corrected.all, track)
  if (corrected.confirmed === null)
    return { venue, timeline, approximate: null }
  // Sun is confirmed only where the confirmed caps alone already give it.
  const sure = dayStates(corrected.confirmed, track)
  const approximate = timeline.map(
    (state, i) => state === 'sun' && sure[i] !== 'sun',
  )
  return {
    venue,
    timeline,
    approximate: approximate.includes(true) ? approximate : null,
  }
}

/**
 * `days` with the visitors' corrections applied. Venues without any keep
 * their day as it is (the same object), so only the corrected ones are
 * computed again.
 */
export function correctDays(
  days: readonly VenueDay[],
  byVenue: ReadonlyMap<string, readonly SunCorrection[]>,
  track: DayTrack,
): readonly VenueDay[] {
  if (byVenue.size === 0) return days
  return days.map((day) => {
    const corrections = byVenue.get(day.venue.id)
    return corrections && day.timeline !== null
      ? venueDay(day.venue, track, corrections)
      : day
  })
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
  const { venue, timeline, approximate } = day
  const hasTerrace = venue.terrace !== null
  if (timeline === null) {
    return {
      venue,
      hasTerrace,
      state: 'unknown',
      category: 'unknown',
      timeline: null,
      approximate: null,
      byVisitors: false,
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

  // The spell the answer talks about: [start, end) in steps.
  let byVisitors = false
  if (approximate !== null) {
    const start = state === 'sun' ? index : nextIndex
    if (start !== null) {
      const end = firstIndex(timeline, start, (s) => s !== 'sun')
      byVisitors = approximate
        .slice(start, end ?? timeline.length)
        .includes(true)
    }
  }

  return {
    venue,
    hasTerrace,
    state,
    category,
    timeline,
    approximate,
    byVisitors,
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

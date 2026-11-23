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
 * `bareTrees[i]` is true when step i is sunny only because deciduous trees
 * count as bare (leaf-off period, ADR-0007); null when that never happens.
 */
export type VenueDay = {
  venue: Terrace
  timeline: SunState[] | null
  bareTrees: boolean[] | null
}

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
  /**
   * The sun spell the card shows (the current one, else the next) reaches
   * the terrace only because trees count as bare (ADR-0007).
   */
  throughBareTrees: boolean
}

export function venueDay(venue: Terrace, track: DayTrack): VenueDay {
  const full = venue.horizon
  const horizon = horizonFor(venue, track.date)
  if (venue.terrace === null || full === null || horizon === null)
    return { venue, timeline: null, bareTrees: null }
  const timeline = track.positions.map((position) =>
    sunState(horizon, position),
  )
  if (horizon === full) return { venue, timeline, bareTrees: null }
  const bareTrees = track.positions.map(
    (position, i) =>
      timeline[i] === 'sun' && sunState(full, position) !== 'sun',
  )
  return {
    venue,
    timeline,
    bareTrees: bareTrees.includes(true) ? bareTrees : null,
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
      throughBareTrees: false,
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

  // The spell the card talks about: [start, end) in steps.
  const spellStart = state === 'sun' ? index : nextIndex
  const spellEnd =
    spellStart === null
      ? null
      : (firstIndex(timeline, spellStart, (s) => s !== 'sun') ??
        timeline.length)
  const throughBareTrees =
    day.bareTrees !== null &&
    spellStart !== null &&
    spellEnd !== null &&
    day.bareTrees.slice(spellStart, spellEnd).includes(true)

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
    throughBareTrees,
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

import type { Terrace } from '../data/terraces.ts'
import {
  minutesOfSunLeft,
  sunPosition,
  sunState,
  type SunState,
} from './sunState.ts'

export type TerraceStatus = {
  terrace: Terrace
  state: SunState
  minutesLeft: number | null
}

const STATE_ORDER: Record<SunState, number> = {
  sun: 0,
  shade: 1,
  night: 2,
  unknown: 3,
}

function compareStatus(a: TerraceStatus, b: TerraceStatus): number {
  return (
    STATE_ORDER[a.state] - STATE_ORDER[b.state] ||
    (b.minutesLeft ?? -1) - (a.minutesLeft ?? -1) ||
    a.terrace.name.localeCompare(b.terrace.name, 'es')
  )
}

/**
 * State of each terrace at `at` and its minutes of sun until `endOfDay`,
 * sunny first, then by minutes of sun left.
 */
export function terraceStatuses(
  terraces: readonly Terrace[],
  at: Date,
  endOfDay: Date,
): TerraceStatus[] {
  return terraces
    .map((terrace) => ({
      terrace,
      state: sunState(terrace.horizon, sunPosition(at, terrace.terrace)),
      minutesLeft: minutesOfSunLeft(
        terrace.horizon,
        terrace.terrace,
        at,
        endOfDay,
      ),
    }))
    .sort(compareStatus)
}

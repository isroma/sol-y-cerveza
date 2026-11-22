import type { SunState } from '../sun/sunState.ts'

/** Shared by the map layer and the list, so both use the same colours. */
export const STATE_COLORS: Record<SunState, string> = {
  sun: '#f5a623',
  shade: '#3d6b99',
  night: '#3b3355',
  unknown: '#9a9a9a',
}

export const STATE_LABELS: Record<SunState, string> = {
  sun: 'Sol',
  shade: 'Sombra',
  night: 'Noche',
  unknown: 'Sin datos',
}

export const STATES: readonly SunState[] = ['sun', 'shade', 'night', 'unknown']

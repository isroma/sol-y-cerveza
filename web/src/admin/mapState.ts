import type { LatLon } from '../data/terraces.ts'

export type MapState =
  'terrace' | 'no_terrace' | 'not_venue' | 'data_terrace' | 'unknown'

export type MapVenue = {
  id: string
  name: string
  at: LatLon
  state: MapState
}

export const STATE_COLORS: Record<MapState, string> = {
  terrace: '#E8A000',
  data_terrace: '#F5CF6B',
  no_terrace: '#6E7B8B',
  not_venue: '#D2453C',
  unknown: '#FFFFFF',
}

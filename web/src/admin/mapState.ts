import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Review } from './review.ts'

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

export const STATE_LABELS: Record<MapState, string> = {
  terrace: 'Terrace',
  no_terrace: 'No terrace',
  not_venue: 'Not a venue',
  data_terrace: 'Terrace in data, unreviewed',
  unknown: 'Unreviewed',
}

/** A venue's state on the map and in the list: its review, else the data. */
export function stateOf(venue: Terrace, review: Review | undefined): MapState {
  if (review?.status) return review.status
  return venue.terrace ? 'data_terrace' : 'unknown'
}

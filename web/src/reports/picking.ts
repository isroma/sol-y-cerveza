import { createContext } from 'react'
import type { LatLon, Terrace } from '../data/terraces.ts'

/** What the card's back places on the map: the venue, or its terrace's tables. */
export type PlaceTarget = 'move' | 'pin'

/**
 * What the position picker is placing: an existing venue or its tables (from
 * the card's back, starting at `from`), or a new venue.
 */
export type Picking =
  | { kind: PlaceTarget; venue: Terrace; from: LatLon }
  /** A missing venue; `name` fills the name field (from the search). */
  | { kind: 'add'; name?: string }

/**
 * Starts the picker from the card's back: the venue's new location ('move',
 * the default) or where its tables are ('pin'). Provided by App; the card
 * reaches it through MapView's portal. Null: no picker here.
 */
export const StartMoveContext = createContext<
  ((venue: Terrace, target?: PlaceTarget) => void) | null
>(null)

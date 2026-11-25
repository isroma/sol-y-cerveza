import { createContext } from 'react'
import type { LatLon, Terrace } from '../data/terraces.ts'

/**
 * What the position picker is placing: an existing venue (from the card's
 * back, starting at `from`), or a new one.
 */
export type Picking =
  | { kind: 'move'; venue: Terrace; from: LatLon }
  /** A missing venue; `name` fills the name field (from the search). */
  | { kind: 'add'; name?: string }

/**
 * Starts the picker for a venue's new location, from the card's back.
 * Provided by App; the card reaches it through MapView's portal. Null: no
 * picker here.
 */
export const StartMoveContext = createContext<
  ((venue: Terrace) => void) | null
>(null)

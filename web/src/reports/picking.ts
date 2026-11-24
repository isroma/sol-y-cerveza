import { createContext } from 'react'
import type { Terrace } from '../data/terraces.ts'

/**
 * What the position picker is placing: an existing venue (`move`), its
 * terrace (`pin`, ADR-0009), or a new venue.
 */
export type Picking =
  | { kind: 'move'; venue: Terrace }
  | { kind: 'pin'; venue: Terrace }
  | { kind: 'add' }

/**
 * Starts the picker for a venue's "Está en otro sitio". Provided by App; the
 * venue card reaches it through MapView's portal. Null: no picker here.
 */
export const StartMoveContext = createContext<
  ((venue: Terrace) => void) | null
>(null)

/** Starts the picker for "La terraza está aquí", like StartMoveContext. */
export const StartPinContext = createContext<((venue: Terrace) => void) | null>(
  null,
)

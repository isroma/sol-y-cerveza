import { createContext } from 'react'
import type { Terrace } from '../data/terraces.ts'

/** What the position picker is placing: an existing venue, or a new one. */
export type Picking = { kind: 'move'; venue: Terrace } | { kind: 'add' }

/**
 * Starts the picker for a venue's "Está en otro sitio". Provided by App; the
 * venue card reaches it through MapView's portal. Null: no picker here.
 */
export const StartMoveContext = createContext<
  ((venue: Terrace) => void) | null
>(null)

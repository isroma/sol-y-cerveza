import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import type { Brand, Item } from '../data/prices.ts'
import type { LatLon } from '../data/terraces.ts'

/**
 * What a visitor has filled in on a card's back. It lives in App so it
 * survives the trip to the map picker and back.
 */
export type ChangeDraft = {
  venueId: string
  item: Item
  brand: Brand
  /** The price as typed. */
  text: string
  closed: boolean
  /** Where the visitor placed the venue on the map, if they moved it. */
  move: LatLon | null
  /**
   * The bot check's token, kept here so the trip to the map picker (which
   * unmounts the card) doesn't run a second check; `tokenAt` is when it came.
   */
  token: string | null
  tokenAt: number
}

export function emptyDraft(venueId: string): ChangeDraft {
  return {
    venueId,
    item: 'cana',
    brand: 'cruzcampo',
    text: '',
    closed: false,
    move: null,
    token: null,
    tokenAt: 0,
  }
}

type DraftState = {
  /** The open card back's draft; null while every card shows its front. */
  draft: ChangeDraft | null
  setDraft: Dispatch<SetStateAction<ChangeDraft | null>>
}

/** Provided by App; a card outside it keeps its draft itself. */
export const DraftContext = createContext<DraftState | null>(null)

export function useDraft(): DraftState {
  const shared = useContext(DraftContext)
  const [draft, setDraft] = useState<ChangeDraft | null>(null)
  return shared ?? { draft, setDraft }
}

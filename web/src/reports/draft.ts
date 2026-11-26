import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react'
import { parseEuros, type Brand, type Item } from '../data/prices.ts'
import type { LatLon, Terrace } from '../data/terraces.ts'
import type { Change } from './reports.ts'

/**
 * What a visitor has filled in on a card's back. It lives in App so it
 * survives the trip to the map picker and back. It keeps everything typed,
 * even what a choice folds away ("Ya no existe", the terrace switch turned
 * off): `sentParts` leaves that out at send time, so undoing the choice
 * brings it back.
 */
export type ChangeDraft = {
  venueId: string
  item: Item
  brand: Brand
  /** The price as typed. */
  text: string
  closed: boolean
  /** "Ahora mismo da el sol": sun on the terrace right now, where the app says shade. */
  sun: boolean
  /** Where the visitor placed the venue on the map, if they moved it. */
  move: LatLon | null
  /**
   * The "Tiene terraza" switch, where the visitor moved it from where it
   * starts (what the data says: on where it has a terrace): false or true
   * against the data; null: untouched. The front's "No" on a venue the data
   * doesn't know also sets false, an explicit answer sent as it is.
   */
  terrace: boolean | null
  /** Where the visitor marked the tables, if they did. */
  pin: LatLon | null
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
    sun: false,
    move: null,
    terrace: null,
    pin: null,
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

/**
 * The terrace answer a draft gives, if any: the switch moved off the data
 * (never "yes" for a terrace the data has), or the front's "No".
 */
export function terraceAnswer(
  venue: Terrace,
  draft: ChangeDraft,
): boolean | null {
  return draft.terrace === null || (venue.terrace !== null && draft.terrace)
    ? null
    : draft.terrace
}

/** Where the "Tiene terraza" switch is: the answer, else what the data says. */
export function terraceOn(venue: Terrace, draft: ChangeDraft): boolean {
  return terraceAnswer(venue, draft) ?? venue.terrace !== null
}

/** What the back sends, without the venue and the bot check's token. */
export type ChangeParts = Omit<Change, 'venueId' | 'token'>

/**
 * What a draft sends: "Ya no existe" goes alone; with the terrace switched
 * off, no sun and no tables; the sun only where its row shows (`sunRow`).
 * A price is left out unless it parses (the back checks its range before
 * it lets it go).
 */
export function sentParts(
  venue: Terrace,
  draft: ChangeDraft,
  sunRow: boolean,
): ChangeParts {
  if (draft.closed) return { closed: true }
  const said = terraceAnswer(venue, draft)
  const terrace = terraceOn(venue, draft)
  const cents = draft.text.trim() === '' ? null : parseEuros(draft.text)
  return {
    ...(cents !== null
      ? {
          price: {
            item: draft.item,
            brand: draft.item === 'tercio' ? draft.brand : null,
            cents,
          },
        }
      : {}),
    ...(draft.move ? { move: draft.move } : {}),
    ...(sunRow && terrace && draft.sun ? { sun: true as const } : {}),
    ...(said !== null ? { terrace: said } : {}),
    ...(terrace && draft.pin ? { pin: draft.pin } : {}),
  }
}

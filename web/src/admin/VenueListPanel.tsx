import { memo } from 'react'
import type { Terrace } from '../data/terraces.ts'
import {
  STATE_COLORS,
  STATE_LABELS,
  stateOf,
  type MapState,
} from './mapState.ts'
import { LOOK_REASONS, type LookReason } from './needsLook.ts'
import type { Review } from './review.ts'

type Props = {
  /** The venues the filter and the search let through. */
  venues: readonly Terrace[]
  reviews: ReadonlyMap<string, Review>
  selectedId: string | null
  onSelect: (id: string) => void
  /** With "Needs a look": why each venue is on it. */
  looks: ReadonlyMap<string, LookReason[]> | null
  /** Whether a venue's terrace pin moved since the build. */
  pinMoved: (id: string) => boolean
}

type RowProps = {
  venue: Terrace
  state: MapState
  current: boolean
  onSelect: (id: string) => void
  /** With "Needs a look": why it is on it. */
  lookReasons: string | null
  /** With "Needs a look": whether its pin moved since the build. */
  moved: boolean
}

// Memoised, like the list: it holds hundreds of venues, and the admin
// re-renders on every selection and pin drag.
const VenueRow = memo(function VenueRow({
  venue,
  state,
  current,
  onSelect,
  lookReasons,
  moved,
}: RowProps) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(venue.id)}
      >
        <span
          className="admin-dot"
          style={{ background: STATE_COLORS[state] }}
          title={STATE_LABELS[state]}
        />
        <span className="admin-name">
          {venue.name}
          {lookReasons !== null && (
            <span className="admin-look">
              {lookReasons}
              {moved && ' · pin moved since the build'}
            </span>
          )}
        </span>
        <span className="admin-kind">{venue.kind}</span>
      </button>
    </li>
  )
})

/** The venue list outside the review queue. */
export const VenueListPanel = memo(function VenueListPanel({
  venues,
  reviews,
  selectedId,
  onSelect,
  looks,
  pinMoved,
}: Props) {
  return (
    <ol className="admin-list">
      {venues.map((v) => (
        <VenueRow
          key={v.id}
          venue={v}
          state={stateOf(v, reviews.get(v.id))}
          current={v.id === selectedId}
          onSelect={onSelect}
          lookReasons={
            looks &&
            (looks.get(v.id) ?? []).map((r) => LOOK_REASONS[r]).join(' · ')
          }
          moved={looks !== null && pinMoved(v.id)}
        />
      ))}
    </ol>
  )
})

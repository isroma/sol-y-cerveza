import type { Terrace } from '../data/terraces.ts'
import { STATE_COLORS, STATE_LABELS, stateOf } from './mapState.ts'
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

/** The venue list outside the review queue. */
export function VenueListPanel({
  venues,
  reviews,
  selectedId,
  onSelect,
  looks,
  pinMoved,
}: Props) {
  return (
    <ol className="admin-list">
      {venues.map((v) => {
        const state = stateOf(v, reviews.get(v.id))
        return (
          <li key={v.id}>
            <button
              type="button"
              aria-current={v.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(v.id)}
            >
              <span
                className="admin-dot"
                style={{ background: STATE_COLORS[state] }}
                title={STATE_LABELS[state]}
              />
              <span className="admin-name">
                {v.name}
                {looks && (
                  <span className="admin-look">
                    {(looks.get(v.id) ?? [])
                      .map((r) => LOOK_REASONS[r])
                      .join(' · ')}
                    {pinMoved(v.id) && ' · pin moved since the build'}
                  </span>
                )}
              </span>
              <span className="admin-kind">{v.kind}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

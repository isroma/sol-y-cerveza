import type { LatLon, Terrace } from '../data/terraces.ts'
import { STATE_LABELS, type MapState } from './mapState.ts'
import { PricesEditor } from './PricesEditor.tsx'
import { priceKey, type VenuePrice } from './pricesCsv.ts'
import { ProposalBox } from './ProposalBox.tsx'
import type { Proposal } from './proposals.ts'
import { ADDED_PREFIX, type Review } from './review.ts'
import { SunPreview } from './SunPreview.tsx'
import { today } from './today.ts'

type Props = {
  venue: Terrace
  state: MapState
  review: Review | undefined
  queueMode: boolean
  /** Review queue progress, shown in the queue. */
  progress: { done: number; total: number }
  /** Why the queue ranks this venue where it is, if it is in the queue. */
  queueReason: string | null
  proposals: readonly Proposal[]
  onAcceptProposal: (proposal: Proposal) => void
  onIgnoreProposal: (proposal: Proposal) => void
  onTerrace: () => void
  onDecide: (status: 'no_terrace' | 'not_venue') => void
  onLooksRight: () => void
  onSkip: () => void
  pinning: boolean
  /** In the queue while pinning: the venue position is the terrace. */
  onKeepPosition: () => void
  /** Where to preview the sun: the terrace pin, or the one being dragged. */
  preview: LatLon | null
  prices: readonly VenuePrice[]
  onSavePrice: (key: string, next: VenuePrice | null) => void
  onNextToReview: () => void
  /** Removes the review row (deletes an added venue). */
  onUndo: () => void
}

function osmUrl(id: string): string | null {
  const match = /^osm:(node|way)\/(\d+)$/.exec(id)
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null
}

/** The selected venue: its decisions, sun preview and beer prices. */
export function VenuePanel({
  venue,
  state,
  review,
  queueMode,
  progress,
  queueReason,
  proposals,
  onAcceptProposal,
  onIgnoreProposal,
  onTerrace,
  onDecide,
  onLooksRight,
  onSkip,
  pinning,
  onKeepPosition,
  preview,
  prices,
  onSavePrice,
  onNextToReview,
  onUndo,
}: Props) {
  const osm = osmUrl(venue.id)
  return (
    <section className="admin-panel" aria-label="Selected venue">
      {queueMode && (
        <p className="admin-queue-head">
          Review queue · {Math.min(progress.done + 1, progress.total)} of{' '}
          {progress.total}
          {queueReason !== null && (
            <span className="admin-reason"> {queueReason}</span>
          )}
        </p>
      )}
      <h2>{venue.name}</h2>
      <p className="admin-meta">
        {venue.kind} · {venue.sources.join(', ')} · {STATE_LABELS[state]}
        {review?.venue && !venue.id.startsWith(ADDED_PREFIX) && ' · moved'}
        {review?.looksRight && ' · looks right'}
      </p>
      <p className="admin-meta">
        {osm ? (
          <a href={osm} target="_blank" rel="noreferrer">
            {venue.id}
          </a>
        ) : (
          venue.id
        )}
      </p>
      <ProposalBox
        proposals={proposals}
        onAccept={onAcceptProposal}
        onIgnore={onIgnoreProposal}
      />
      <div
        className={
          queueMode ? 'admin-actions admin-actions-big' : 'admin-actions'
        }
      >
        <button
          type="button"
          aria-pressed={review?.status === 'terrace'}
          onClick={onTerrace}
        >
          Terrace <kbd>T</kbd>
        </button>
        <button
          type="button"
          aria-pressed={review?.status === 'no_terrace'}
          onClick={() => onDecide('no_terrace')}
        >
          No terrace <kbd>N</kbd>
        </button>
        {!venue.id.startsWith(ADDED_PREFIX) && (
          <button
            type="button"
            aria-pressed={review?.status === 'not_venue'}
            onClick={() => onDecide('not_venue')}
          >
            Not a venue <kbd>X</kbd>
          </button>
        )}
        <button
          type="button"
          aria-pressed={review?.looksRight === true}
          title="Right as it is: keeps the terrace where it is (or no terrace) and leaves Needs a look"
          onClick={onLooksRight}
        >
          Looks right <kbd>Y</kbd>
        </button>
        {queueMode && (
          <button type="button" onClick={onSkip}>
            Skip <kbd>S</kbd>
          </button>
        )}
      </div>
      {pinning ? (
        <p className="admin-pin-mode">
          Click the map where the tables are
          {queueMode ? (
            <>
              , or{' '}
              <button
                type="button"
                className="admin-link"
                onClick={onKeepPosition}
              >
                keep the venue position
              </button>{' '}
              <kbd>Enter</kbd>. Esc cancels.
            </>
          ) : (
            '. Esc cancels.'
          )}
        </p>
      ) : queueMode ? (
        <p className="admin-help">
          Each decision moves on to the next venue. T then a click on the map
          pins the terrace; Y keeps what the data says; Skip puts the venue at
          the end.
        </p>
      ) : (
        <p className="admin-help">
          T marks a terrace and lets you place its pin with one click; press T
          again to move it. Drag the dark pin to fix the venue position.
        </p>
      )}
      {preview && <SunPreview at={preview} />}
      <h3 className="admin-subhead">Beer prices</h3>
      <PricesEditor
        key={venue.id}
        venueId={venue.id}
        prices={prices}
        today={today()}
        onSave={(p) => onSavePrice(priceKey(p), p)}
        onRemove={(key) => onSavePrice(key, null)}
      />
      <div className="admin-actions">
        {!queueMode && (
          <button type="button" onClick={onNextToReview}>
            Next to review <kbd>J</kbd>
          </button>
        )}
        {review && (
          <button type="button" onClick={onUndo}>
            {venue.id.startsWith(ADDED_PREFIX) ? 'Delete venue' : 'Undo review'}
          </button>
        )}
      </div>
    </section>
  )
}

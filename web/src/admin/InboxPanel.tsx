import type { Terrace } from '../data/terraces.ts'
import { ANSWERS, describeItem, KIND_LABELS, type InboxItem } from './inbox.ts'
import type { ReportedVenue } from './reports.ts'
import { SunReportDetails } from './SunReportDetails.tsx'

/**
 * The open Inbox item on the map: what it says and Accept (Y), Reject (N) or
 * Skip (S), keys as in To review (ANSWERS). Each answer moves on to the next
 * item.
 */
export function InboxPanel({
  item,
  position,
  total,
  venueOf,
  terraceOf,
  pinMoved,
  onMovePin,
  busy,
  failure,
  onAnswer,
}: {
  item: InboxItem
  /** 1-based, in the list as shown. */
  position: number
  total: number
  venueOf: (id: string) => ReportedVenue | undefined
  /** The venue's record in the published terraces.json (for a sun report). */
  terraceOf: (id: string) => Terrace | undefined
  /** Whether the venue's terrace pin moved since the build. */
  pinMoved: (id: string) => boolean
  /** Opens a venue in To review, to move its pin by hand. */
  onMovePin: (id: string) => void
  busy: boolean
  failure: string | null
  onAnswer: (choice: 'yes' | 'no' | 'skip') => void
}) {
  const { title, detail } = describeItem(item, venueOf)
  const answers = ANSWERS[item.kind]
  return (
    <section className="admin-panel" aria-label="Inbox item">
      <div className="admin-panel-head">
        <h2>{title}</h2>
        <span className="admin-meta">
          Inbox {position} of {total}
        </span>
      </div>
      <p className="admin-meta">
        {KIND_LABELS[item.kind]} · {detail}
      </p>
      {item.kind === 'sun' && (
        <SunReportDetails
          report={item.sun}
          terrace={terraceOf(item.sun.venueId)}
          pinMoved={pinMoved(item.sun.venueId)}
          onMovePin={
            venueOf(item.sun.venueId) ? () => onMovePin(item.sun.venueId) : null
          }
        />
      )}
      {item.kind === 'price' && (
        <>
          <q className="admin-candidate-snippet">{item.candidate.snippet}</q>
          <p className="admin-meta">
            <a href={item.candidate.sourceUrl} target="_blank" rel="noreferrer">
              Open the page
            </a>{' '}
            · fetched {item.candidate.fetched}
          </p>
        </>
      )}
      <div className="admin-actions">
        <button
          type="button"
          className="admin-primary"
          disabled={busy}
          onClick={() => onAnswer('yes')}
        >
          {answers.yes.label} <kbd>{answers.yes.key.toUpperCase()}</kbd>
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer('no')}>
          {answers.no.label} <kbd>{answers.no.key.toUpperCase()}</kbd>
        </button>
        <button type="button" disabled={busy} onClick={() => onAnswer('skip')}>
          Skip <kbd>S</kbd>
        </button>
      </div>
      {failure && (
        <p className="admin-error" role="alert">
          Not saved: {failure}
        </p>
      )}
    </section>
  )
}

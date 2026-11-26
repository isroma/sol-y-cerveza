import { memo } from 'react'
import type { Scored } from './queueScore.ts'
import { trustHint, type Trust } from './trust.ts'

type Props = {
  queue: readonly Scored[]
  /** Trust tiers by venue id (trust.ts). */
  trust: ReadonlyMap<string, Trust>
  /** No trust file yet: say how to write it. */
  trustMissing: boolean
  skipped: readonly string[]
  selectedId: string | null
  onSelect: (id: string) => void
}

type RowProps = {
  item: Scored
  /** trustHint of the venue, or ''. */
  hint: string
  rank: number
  skipped: boolean
  current: boolean
  onSelect: (id: string) => void
}

// Memoised, like the list: the queue holds hundreds of venues, and the admin
// re-renders on every selection, decision and pin drag.
const QueueRow = memo(function QueueRow({
  item,
  hint,
  rank,
  skipped,
  current,
  onSelect,
}: RowProps) {
  return (
    <li>
      <button
        type="button"
        aria-current={current ? 'true' : undefined}
        onClick={() => onSelect(item.venue.id)}
      >
        <span className="admin-rank">{rank}</span>
        <span className="admin-name">
          {item.venue.name}
          <span className="admin-reason">
            {skipped ? 'Skipped · ' : ''}
            {hint ? `${hint} · ` : ''}
            {item.reason}
          </span>
        </span>
        <span className="admin-kind">{item.venue.kind}</span>
      </button>
    </li>
  )
})

/** The review queue, weak sources first, then best value (queueScore.ts). */
export const QueueList = memo(function QueueList({
  queue,
  trust,
  trustMissing,
  skipped,
  selectedId,
  onSelect,
}: Props) {
  const later = new Set(skipped)
  return (
    <>
      {trustMissing && (
        <p className="admin-meta admin-reason">
          No trust tiers yet: run{' '}
          <code>uv run python -m solycerveza.trust</code> in{' '}
          <code>pipeline/</code>, then reload.
        </p>
      )}
      <ol className="admin-list admin-queue-list">
        {queue.map((s, index) => (
          <QueueRow
            key={s.venue.id}
            item={s}
            hint={trustHint(trust.get(s.venue.id))}
            rank={index + 1}
            skipped={later.has(s.venue.id)}
            current={s.venue.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ol>
    </>
  )
})

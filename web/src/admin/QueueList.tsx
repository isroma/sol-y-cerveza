import { memo } from 'react'
import type { Scored } from './queueScore.ts'

type Props = {
  queue: readonly Scored[]
  skipped: readonly string[]
  selectedId: string | null
  onSelect: (id: string) => void
}

type RowProps = {
  item: Scored
  rank: number
  skipped: boolean
  current: boolean
  onSelect: (id: string) => void
}

// Memoised, like the list: the queue holds hundreds of venues, and the admin
// re-renders on every selection, decision and pin drag.
const QueueRow = memo(function QueueRow({
  item,
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
            {item.reason}
          </span>
        </span>
        <span className="admin-kind">{item.venue.kind}</span>
      </button>
    </li>
  )
})

/** The review queue, best value first (queueScore.ts). */
export const QueueList = memo(function QueueList({
  queue,
  skipped,
  selectedId,
  onSelect,
}: Props) {
  const later = new Set(skipped)
  return (
    <ol className="admin-list admin-queue-list">
      {queue.map((s, index) => (
        <QueueRow
          key={s.venue.id}
          item={s}
          rank={index + 1}
          skipped={later.has(s.venue.id)}
          current={s.venue.id === selectedId}
          onSelect={onSelect}
        />
      ))}
    </ol>
  )
})

import { useCallback, useMemo, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import { queueOrder, type Scored } from './queueScore.ts'
import type { Review } from './review.ts'
import type { ReviewChange } from './useAdminData.ts'

type Options = {
  venues: readonly Terrace[]
  reviews: ReadonlyMap<string, Review>
  /** Every venue with its queue score (scoreVenues). */
  scored: readonly Scored[]
  selectedId: string | null
  select: (id: string | null) => void
  change: (change: ReviewChange) => void
  setPinning: (pinning: boolean) => void
  /** Y on the selected venue (see Admin.tsx). */
  markLooksRight: () => void
}

/**
 * The review queue: venues one at a time, best value first (queueScore.ts),
 * and the decisions that move on to the next one while it is open.
 */
export function useReviewQueue({
  venues,
  reviews,
  scored,
  selectedId,
  select,
  change,
  setPinning,
  markLooksRight,
}: Options) {
  const [queueMode, setQueueMode] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  // The venues without a decision when the queue was opened, for progress.
  const [queueBase, setQueueBase] = useState<ReadonlySet<string>>(new Set())

  const queue = useMemo(
    () => queueOrder(scored, reviews, skipped),
    [scored, reviews, skipped],
  )

  // The queue's next venue after `fromId` is decided or skipped: the best
  // one left (the order can change as terraces get confirmed).
  // Applied in the render that already has the decision, so the next venue
  // comes from the new order (a confirmed terrace raises its neighbours).
  const [advanceFrom, setAdvanceFrom] = useState<string | null>(null)
  const advance = useCallback((fromId: string) => setAdvanceFrom(fromId), [])
  if (advanceFrom !== null) {
    setAdvanceFrom(null)
    select(queue.find((s) => s.venue.id !== advanceFrom)?.venue.id ?? null)
  }

  const skip = useCallback(() => {
    if (!selectedId) return
    setSkipped((current) => [
      ...current.filter((id) => id !== selectedId),
      selectedId,
    ])
    advance(selectedId)
  }, [selectedId, advance])

  // A decision on the selected venue; in the queue it moves on to the next.
  const decide = useCallback(
    (status: 'no_terrace' | 'not_venue') => {
      if (!selectedId) return
      setPinning(false)
      change({ kind: 'status', status })
      if (queueMode) advance(selectedId)
    },
    [selectedId, setPinning, change, queueMode, advance],
  )

  const looksRightAndGo = useCallback(() => {
    if (!selectedId) return
    markLooksRight()
    if (queueMode) advance(selectedId)
  }, [selectedId, markLooksRight, queueMode, advance])

  /** Opens the queue on its best venue. */
  const startQueue = () => {
    setQueueMode(true)
    setQueueBase(new Set(queue.map((s) => s.venue.id)))
    select(queue[0]?.venue.id ?? null)
  }

  const nextToReview = useCallback(() => {
    const start = venues.findIndex((v) => v.id === selectedId)
    const order = [...venues.slice(start + 1), ...venues.slice(0, start + 1)]
    const next = order.find((v) => !reviews.get(v.id)?.status)
    if (next) select(next.id)
  }, [venues, reviews, selectedId, select])

  // Queue progress over the venues that were open when it was opened; the
  // value share weighs each by its current score.
  const progress = useMemo(() => {
    let done = 0
    let doneValue = 0
    let allValue = 0
    for (const s of scored) {
      if (!queueBase.has(s.venue.id)) continue
      const value = Math.max(0, s.score)
      allValue += value
      if (reviews.get(s.venue.id)?.status) {
        done++
        doneValue += value
      }
    }
    const total = queueBase.size
    return {
      done,
      total,
      percent: total ? Math.floor((done / total) * 100) : 0,
      value: allValue ? Math.floor((doneValue / allValue) * 100) : 0,
    }
  }, [scored, queueBase, reviews])
  const queueItem = queue.find((s) => s.venue.id === selectedId) ?? null

  return {
    queueMode,
    setQueueMode,
    skipped,
    queue,
    queueItem,
    progress,
    advance,
    skip,
    decide,
    looksRightAndGo,
    startQueue,
    nextToReview,
  }
}

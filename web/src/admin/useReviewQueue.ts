import { useCallback, useMemo, useState } from 'react'
import type { Terrace } from '../data/terraces.ts'
import { queueOrder, type Scored } from './queueScore.ts'
import type { Review } from './review.ts'
import type { ReviewChange } from './useAdminData.ts'

type Options = {
  /** "To review" with no search: the list is the queue, and decisions move on. */
  queueMode: boolean
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
 * The review queue: the "To review" list, best value first (queueScore.ts),
 * and the decisions that move on to the next venue while it is shown.
 */
export function useReviewQueue({
  queueMode,
  venues,
  reviews,
  scored,
  selectedId,
  select,
  change,
  setPinning,
  markLooksRight,
}: Options) {
  const [skipped, setSkipped] = useState<string[]>([])

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

  const nextToReview = useCallback(() => {
    const start = venues.findIndex((v) => v.id === selectedId)
    const order = [...venues.slice(start + 1), ...venues.slice(0, start + 1)]
    const next = order.find((v) => !reviews.get(v.id)?.status)
    if (next) select(next.id)
  }, [venues, reviews, selectedId, select])

  const queueItem = queue.find((s) => s.venue.id === selectedId) ?? null

  return {
    skipped,
    queue,
    queueItem,
    advance,
    skip,
    decide,
    looksRightAndGo,
    nextToReview,
  }
}

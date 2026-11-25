import { useEffect, useRef, useState } from 'react'
import { fetchReports, resolveReports, type VenueReport } from './reports.ts'

/**
 * Applies the owner's changes from owner mode (moves, closures, new venues)
 * once the admin's data has loaded, without review: each one through the same
 * path as an accepted visitor report, then marked accepted in the API. One at
 * a time, so each sees the review rows the one before saved. Publish ships
 * them as usual.
 */
export function useOwnerChanges({
  ready,
  accept,
  onDone,
}: {
  /** The data and review rows have loaded. */
  ready: boolean
  /** Applies one report to the review rows; true once saved. */
  accept: (report: VenueReport) => Promise<boolean>
  onDone: (applied: number, problems: string[]) => void
}) {
  const [queue, setQueue] = useState<VenueReport[] | null>(null)
  const result = useRef({ applied: 0, problems: [] as string[] })
  const busy = useRef(false)
  const latest = useRef({ accept, onDone })
  useEffect(() => {
    latest.current = { accept, onDone }
  })

  useEffect(() => {
    if (!ready || queue !== null) return
    void fetchReports().then((r) => {
      const own = (r.reports ?? []).filter((report) => report.owner)
      setQueue(own)
    })
  }, [ready, queue])

  useEffect(() => {
    if (!queue || busy.current) return
    const [next, ...rest] = queue
    if (!next) {
      if (result.current.applied || result.current.problems.length)
        latest.current.onDone(result.current.applied, result.current.problems)
      result.current = { applied: 0, problems: [] }
      return
    }
    busy.current = true
    void (async () => {
      if (await latest.current.accept(next)) {
        const failed = await resolveReports(next.ids, 'accepted')
        if (failed) result.current.problems.push(failed)
        else result.current.applied++
      } else result.current.problems.push(`not saved: ${next.kind}`)
      busy.current = false
      setQueue(rest)
    })()
  }, [queue])
}

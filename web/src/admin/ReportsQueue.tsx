import { useCallback, useEffect, useState } from 'react'
import {
  describeReport,
  fetchReports,
  isStale,
  REPORTS_API as API,
  type ReportedVenue,
  type VenueReport,
} from './reports.ts'

type Props = {
  venueOf: (venueId: string) => ReportedVenue | undefined
  /** Selects the venue or shows the proposed point on the map. */
  onSelect: (report: VenueReport) => void
  /** Applies the report to the review; true once it is saved. */
  onAccept: (report: VenueReport) => Promise<boolean>
  /** The number of pending reports, after every load. */
  onCount?: (count: number) => void
}

/** Pending visitor venue reports from the API, to accept or reject. */
export function ReportsQueue({ venueOf, onSelect, onAccept, onCount }: Props) {
  const [reports, setReports] = useState<VenueReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const show = useCallback(
    (result: Awaited<ReturnType<typeof fetchReports>>) => {
      setReports(result.reports)
      setError(result.error)
      if (result.reports) onCount?.(result.reports.length)
    },
    [onCount],
  )

  useEffect(() => {
    let live = true
    void fetchReports().then((result) => {
      if (live) show(result)
    })
    return () => {
      live = false
    }
  }, [show])

  const resolve = async (
    report: VenueReport,
    status: 'accepted' | 'rejected',
  ) => {
    if (status === 'accepted' && !(await onAccept(report))) return
    let failed: string | null = null
    try {
      const response = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: report.ids, status }),
      })
      if (!response.ok) failed = `HTTP ${response.status}`
    } catch (e) {
      failed = String(e)
    }
    show(await fetchReports())
    if (failed) setError(`not resolved: ${failed}`)
  }

  if (error) return <p className="admin-help">Reports unavailable: {error}</p>
  if (!reports) return <p className="admin-help">Loading reports…</p>
  if (reports.length === 0)
    return <p className="admin-help">No pending reports.</p>
  return (
    <ol className="admin-queue" aria-label="Venue reports">
      {reports.map((r) => {
        const venue = r.kind === 'add' ? undefined : venueOf(r.venueId)
        const stale = isStale(r, venue)
        return (
          <li key={r.ids.join(',')}>
            <button
              type="button"
              className="admin-queue-venue"
              disabled={stale}
              onClick={() => onSelect(r)}
            >
              {describeReport(r, venue)}
            </button>
            <span className="admin-actions">
              {!stale && (
                <button
                  type="button"
                  onClick={() => void resolve(r, 'accepted')}
                >
                  Accept
                </button>
              )}
              <button type="button" onClick={() => void resolve(r, 'rejected')}>
                Reject
              </button>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

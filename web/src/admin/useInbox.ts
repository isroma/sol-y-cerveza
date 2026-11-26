import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import {
  fetchInbox,
  inboxItems,
  itemPoint,
  itemVenueId,
  nextItem,
  postDecision,
  type InboxItem,
  type InboxKind,
  type SuggestionGroup,
} from './inbox.ts'
import type { JunkItem } from './junk.ts'
import type { VenuePrice } from './pricesCsv.ts'
import { toPrice, candidateKey, type Lead } from './priceCandidates.ts'
import { resolveReports, type VenueReport } from './reports.ts'
import { useSunCorrections } from './useSunCorrections.ts'

export type InboxFilter = 'all' | InboxKind

type Options = {
  junk: readonly JunkItem[]
  /** Shows the item's venue (or none) and its proposed point on the map. */
  show: (venueId: string | null, point: LatLon | null) => void
  acceptReport: (report: VenueReport) => Promise<boolean>
  acceptSuggestion: (group: SuggestionGroup) => Promise<void>
  savePrice: (price: VenuePrice) => Promise<void>
  /** Marks a venue "not a venue" in venue_review.csv; true once saved. */
  markNotVenue: (venueId: string) => Promise<boolean>
  /** Accepted sun reports were added to sun_corrections.csv. */
  onSunRecorded: (added: number) => void
}

type Data = Awaited<ReturnType<typeof fetchInbox>>

/**
 * The Inbox tab: its items, the one open, and Accept / Reject / Skip, each of
 * which moves on to the next item in the list.
 */
export function useInbox({
  junk,
  show,
  acceptReport,
  acceptSuggestion,
  savePrice,
  markNotVenue,
  onSunRecorded,
}: Options) {
  const [data, setData] = useState<Data | null>(null)
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set())
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const load = useCallback(async () => setData(await fetchInbox()), [])
  useEffect(() => {
    let live = true
    void fetchInbox().then((d) => {
      if (live) setData(d)
    })
    return () => {
      live = false
    }
  }, [])

  // Accepted sun reports go into sun_corrections.csv for Publish: once the
  // Inbox has loaded, and after each accepted sun report.
  const sunCsv = useSunCorrections({
    ready: data !== null,
    onAdded: onSunRecorded,
  })

  const items = useMemo(
    () =>
      inboxItems({
        reports: data?.reports ?? [],
        sun: data?.sun ?? [],
        suggestions: data?.suggestions ?? [],
        candidates: data?.candidates ?? [],
        junk,
        kept,
      }),
    [data, junk, kept],
  )
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.kind === filter)),
    [items, filter],
  )
  const open = items.find((i) => i.key === openKey) ?? null

  const openItem = useCallback(
    (item: InboxItem | null) => {
      setOpenKey(item?.key ?? null)
      setFailure(null)
      if (item) show(itemVenueId(item), itemPoint(item))
      else show(null, null)
    },
    [show],
  )

  /** Applies a yes or no; null when done, or why it failed. */
  const decide = async (
    item: InboxItem,
    yes: boolean,
  ): Promise<string | null> => {
    switch (item.kind) {
      case 'report':
        if (yes && !(await acceptReport(item.report)))
          return 'not saved in venue_review.csv'
        return resolveReports(item.report.ids, yes ? 'accepted' : 'rejected')
      case 'sun': {
        // Saved in the API at once; an accepted one is then copied into
        // sun_corrections.csv, which ships with the next Publish.
        const failed = await postDecision(ADMIN_ENDPOINTS.sun, {
          ids: item.sun.ids,
          status: yes ? 'accepted' : 'rejected',
        })
        if (!failed && yes) void sunCsv.sync()
        return failed
      }
      case 'suggestion':
        if (yes) await acceptSuggestion(item.group)
        return postDecision(ADMIN_ENDPOINTS.suggestions, {
          venueId: item.group.venue_id,
          item: item.group.item,
          brand: item.group.brand || null,
          cents: item.group.cents,
          status: yes ? 'accepted' : 'rejected',
        })
      case 'price':
        if (yes) await savePrice(toPrice(item.candidate))
        return postDecision(ADMIN_ENDPOINTS.priceCandidates, {
          key: candidateKey(item.candidate),
          status: yes ? 'accepted' : 'dismissed',
        })
      case 'junk':
        if (!yes) {
          setKept((k) => new Set([...k, item.junk.venue.id]))
          return null
        }
        return (await markNotVenue(item.junk.venue.id))
          ? null
          : 'not saved in venue_review.csv'
    }
  }

  const answer = async (item: InboxItem, choice: 'yes' | 'no' | 'skip') => {
    const next = nextItem(shown, item.key)
    if (choice === 'skip') return openItem(next)
    setBusy(true)
    const failed = await decide(item, choice === 'yes')
    setBusy(false)
    if (failed) return setFailure(failed)
    if (item.kind !== 'junk') void load()
    openItem(next)
  }

  return {
    items,
    shown,
    open,
    filter,
    setFilter,
    openItem,
    answer,
    busy,
    failure,
    errors: [
      ...(data?.errors ?? []),
      ...(sunCsv.error ? [`Sun corrections: ${sunCsv.error}`] : []),
    ],
    loaded: data !== null,
    reload: load,
    leads: data?.leads ?? ([] as Lead[]),
  }
}

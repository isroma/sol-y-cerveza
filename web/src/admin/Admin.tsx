import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { AdminMap } from './AdminMap.tsx'
import { PricesEditor } from './PricesEditor.tsx'
import { PriceCandidates } from './PriceCandidates.tsx'
import { SuggestionsQueue, type SuggestionGroup } from './SuggestionsQueue.tsx'
import { BRANDS } from '../data/prices.ts'
import { priceKey, venuePriceSchema, type VenuePrice } from './pricesCsv.ts'
import { STATE_COLORS, type MapState, type MapVenue } from './mapState.ts'
import { dayTrack } from '../sun/dayTrack.ts'
import { toMadridLocal } from '../time/madrid.ts'
import {
  LOOK_REASONS,
  needsALook,
  referenceDates,
  type LookReason,
} from './needsLook.ts'
import { SunPreview } from './SunPreview.tsx'
import { BADAJOZ_CENTER } from '../config.ts'
import { BatchDismiss } from './BatchDismiss.tsx'
import { junkSignalsAll, likelyJunk } from './junk.ts'
import { ProposalBox } from './ProposalBox.tsx'
import {
  acceptChange,
  openProposals,
  proposalKey,
  proposalsResponseSchema,
  type Proposal,
  type ProposalsResponse,
} from './proposals.ts'
import { queueOrder, scoreVenues } from './queueScore.ts'
import type { Ghost } from './AdminMap.tsx'
import {
  ADDED_PREFIX,
  addedId,
  cleanName,
  KINDS,
  nextReview,
  reviewSchema,
  type Kind,
  type Review,
  type Status,
} from './review.ts'
import {
  describe,
  IDLE,
  isActive,
  isBusy,
  publishStatusSchema,
  type PublishStatus,
} from './publishStatus.ts'

const API = '/__admin/review'
const PUBLISH_API = '/__admin/publish'
const PRICES_API = '/__admin/prices'
const PROPOSALS_API = '/__admin/proposals'

const CENTRE: LatLon = { lat: BADAJOZ_CENTER[1], lon: BADAJOZ_CENTER[0] }
/** How long a batch "not a venue" waits for Undo before it is saved. */
const DISMISS_UNDO_MS = 10_000
const NO_PROPOSALS: ProposalsResponse = {
  proposals: [],
  ignored: [],
  errors: [],
}

type Filter = 'todo' | 'not_venue' | 'all' | 'look'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To review' },
  { id: 'not_venue', label: 'Not a venue' },
  { id: 'all', label: 'All' },
  { id: 'look', label: 'Needs a look' },
]

const STATE_LABELS: Record<MapState, string> = {
  terrace: 'Terrace',
  no_terrace: 'No terrace',
  not_venue: 'Not a venue',
  data_terrace: 'Terrace in data, unreviewed',
  unknown: 'Unreviewed',
}

function today(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

function stateOf(venue: Terrace, review: Review | undefined): MapState {
  if (review?.status) return review.status
  return venue.terrace ? 'data_terrace' : 'unknown'
}

function matches(filter: Filter, review: Review | undefined): boolean {
  if (filter === 'all' || filter === 'look') return true
  if (filter === 'todo') return !review?.status
  return review?.status === filter
}

function osmUrl(id: string): string | null {
  const match = /^osm:(node|way)\/(\d+)$/.exec(id)
  return match ? `https://www.openstreetmap.org/${match[1]}/${match[2]}` : null
}

type Adding = { name: string; kind: Kind; at: LatLon | null }

/** A venue added in the admin view, shaped like a dataset record. */
function addedVenue(review: Review): Terrace | null {
  if (!review.venueId.startsWith(ADDED_PREFIX)) return null
  if (!review.name || !review.kind || !review.venue) return null
  return {
    id: review.venueId,
    name: review.name,
    kind: review.kind,
    venue: review.venue,
    terrace: null,
    sources: ['review'],
    verified: null,
    horizon: null,
  }
}

async function fetchPrices(): Promise<Map<string, VenuePrice>> {
  const response = await fetch(PRICES_API)
  if (!response.ok)
    throw new Error(`GET ${PRICES_API}: HTTP ${response.status}`)
  const rows = venuePriceSchema.array().parse(await response.json())
  return new Map(rows.map((p) => [priceKey(p), p]))
}

/** The machine proposals; none when the file or the endpoint is missing. */
async function fetchProposals(): Promise<ProposalsResponse> {
  const response = await fetch(PROPOSALS_API)
  if (!response.ok)
    throw new Error(`GET ${PROPOSALS_API}: HTTP ${response.status}`)
  return proposalsResponseSchema.parse(await response.json())
}

async function fetchReviews(): Promise<Map<string, Review>> {
  const response = await fetch(API)
  if (!response.ok) throw new Error(`GET ${API}: HTTP ${response.status}`)
  const rows = reviewSchema.array().parse(await response.json())
  return new Map(rows.map((r) => [r.venueId, r]))
}

export function Admin() {
  const [dataVenues, setVenues] = useState<Terrace[]>([])
  const [adding, setAdding] = useState<Adding | null>(null)
  const [reviews, setReviews] = useState(new Map<string, Review>())
  const [prices, setPrices] = useState(new Map<string, VenuePrice>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('todo')
  const [message, setMessage] = useState('Loading…')
  const [pinning, setPinning] = useState(false)
  // The terrace pin while it is being dragged, for a live sun preview.
  const [dragging, setDragging] = useState<LatLon | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const [publish, setPublish] = useState<PublishStatus>(IDLE)
  // Review queue: venues one at a time, best value first (queueScore.ts).
  const [queueMode, setQueueMode] = useState(false)
  const [skipped, setSkipped] = useState<string[]>([])
  // The venues without a decision when the queue was opened, for progress.
  const [queueBase, setQueueBase] = useState<ReadonlySet<string>>(new Set())
  const [junkOpen, setJunkOpen] = useState(false)
  const [dismissing, setDismissing] = useState<{
    ids: string[]
    until: number
    saving: boolean
  } | null>(null)
  const [proposalData, setProposalData] =
    useState<ProposalsResponse>(NO_PROPOSALS)

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    setPinning(false)
    setDragging(null)
  }, [])

  // Sun checks on the horizons in terraces.json, for the "Needs a look" filter.
  // Terraces reviewed away are left out; moved pins keep their stale horizon
  // until the next build, so the list says so.
  const [tracks] = useState(() =>
    referenceDates(toMadridLocal(new Date()).date).map(dayTrack),
  )
  const looks = useMemo(() => {
    const out = new Map<string, LookReason[]>()
    for (const item of needsALook(dataVenues, tracks)) {
      const review = reviews.get(item.venue.id)
      if (review?.status === 'no_terrace' || review?.status === 'not_venue')
        continue
      // Checked and right as it is (Y), e.g. a narrow street with little sun.
      if (review?.looksRight) continue
      out.set(item.venue.id, item.reasons)
    }
    return out
  }, [dataVenues, tracks, reviews])

  useEffect(() => {
    Promise.all([loadTerraces(), fetchReviews(), fetchPrices()])
      .then(([file, rows, priceRows]) => {
        setVenues(file.terraces)
        setReviews(rows)
        setPrices(priceRows)
        setMessage('')
      })
      .catch((error: unknown) => setMessage(String(error)))
    fetchProposals()
      .then(setProposalData)
      .catch((error: unknown) =>
        setMessage(`Machine proposals unavailable: ${String(error)}`),
      )
  }, [])

  // Picks up a Publish already running (e.g. after a reload), then follows it.
  const active = isActive(publish)
  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const response = await fetch(PUBLISH_API)
        const parsed = publishStatusSchema.safeParse(await response.json())
        if (!stop && parsed.success) setPublish(parsed.data)
      } catch {
        // Retried on the next tick.
      }
    }
    void poll()
    if (!active) return
    const timer = window.setInterval(() => void poll(), 2000)
    return () => {
      stop = true
      window.clearInterval(timer)
    }
  }, [active])

  const venues = useMemo(
    () =>
      [
        ...dataVenues,
        ...[...reviews.values()].flatMap((r) => addedVenue(r) ?? []),
      ].sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [dataVenues, reviews],
  )

  const mapVenues = useMemo<MapVenue[]>(
    () =>
      venues.map((v) => {
        const review = reviews.get(v.id)
        return {
          id: v.id,
          name: v.name,
          at: review?.venue ?? v.venue,
          state: stateOf(v, review),
        }
      }),
    [venues, reviews],
  )

  const proposals = useMemo(
    () =>
      openProposals(
        proposalData.proposals,
        reviews,
        new Set(proposalData.ignored),
      ),
    [proposalData, reviews],
  )
  const junkSignals = useMemo(
    () => junkSignalsAll(venues, reviews, CENTRE),
    [venues, reviews],
  )
  const scored = useMemo(
    () => scoreVenues(venues, reviews, proposals, CENTRE, junkSignals),
    [venues, reviews, proposals, junkSignals],
  )
  const queue = useMemo(
    () => queueOrder(scored, reviews, skipped),
    [scored, reviews, skipped],
  )
  const junk = useMemo(() => {
    const staged = new Set(dismissing?.ids)
    return likelyJunk(venues, reviews, junkSignals).filter(
      (item) => !staged.has(item.venue.id),
    )
  }, [venues, reviews, junkSignals, dismissing])

  const listed = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es')
    return venues.filter(
      (v) =>
        matches(filter, reviews.get(v.id)) &&
        (filter !== 'look' || looks.has(v.id)) &&
        (!q || v.name.toLocaleLowerCase('es').includes(q)),
    )
  }, [venues, reviews, filter, query, looks])

  const mapShown = useMemo(() => {
    const ids = new Set(listed.map((v) => v.id))
    return mapVenues.filter((v) => ids.has(v.id))
  }, [listed, mapVenues])

  const selectedVenue = venues.find((v) => v.id === selectedId) ?? null
  const selectedMap: MapVenue | null = adding
    ? adding.at && {
        id: 'new',
        name: adding.name || 'New venue',
        at: adding.at,
        state: 'unknown',
      }
    : (mapVenues.find((v) => v.id === selectedId) ?? null)
  const review = selectedId ? reviews.get(selectedId) : undefined
  const terrace: LatLon | null = !selectedVenue
    ? null
    : review?.status
      ? review.status === 'terrace'
        ? (review.terrace ?? selectedVenue.terrace)
        : null
      : selectedVenue.terrace
  const preview = dragging ?? terrace

  // Moving the pin changes the terrace; the dataset horizon no longer applies.
  const pinMoved = (id: string): boolean => {
    const pinned = reviews.get(id)?.terrace
    const data = venues.find((v) => v.id === id)?.terrace
    return !!pinned && (pinned.lat !== data?.lat || pinned.lon !== data.lon)
  }

  // Rows show at once; on a failed write the file's rows come back.
  const saveAll = useCallback(
    async (changes: readonly { venueId: string; next: Review | null }[]) => {
      setReviews((current) => {
        const copy = new Map(current)
        for (const { venueId, next } of changes) {
          if (next) copy.set(venueId, next)
          else copy.delete(venueId)
        }
        return copy
      })
      try {
        for (const { venueId, next } of changes) {
          const response = next
            ? await fetch(API, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(next),
              })
            : await fetch(`${API}?venue_id=${encodeURIComponent(venueId)}`, {
                method: 'DELETE',
              })
          if (!response.ok) throw new Error(await response.text())
        }
        setMessage('Saved')
        return true
      } catch (error) {
        setMessage(`Not saved: ${String(error)}`)
        setReviews(await fetchReviews())
        return false
      }
    },
    [],
  )

  const save = useCallback(
    async (venueId: string, next: Review | null) => {
      await saveAll([{ venueId, next }])
    },
    [saveAll],
  )

  const savePrice = useCallback(
    async (key: string, next: VenuePrice | null) => {
      setPrices((current) => {
        const copy = new Map(current)
        if (next) copy.set(key, next)
        else copy.delete(key)
        return copy
      })
      try {
        const response = next
          ? await fetch(PRICES_API, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(next),
            })
          : await fetch(`${PRICES_API}?key=${encodeURIComponent(key)}`, {
              method: 'DELETE',
            })
        if (!response.ok) throw new Error(await response.text())
        setMessage('Saved')
      } catch (error) {
        setMessage(`Not saved: ${String(error)}`)
        setPrices(await fetchPrices())
      }
    },
    [],
  )

  const change = useCallback(
    (
      change:
        | { kind: 'status'; status: Status }
        | { kind: 'terrace'; at: LatLon }
        | { kind: 'venue'; at: LatLon }
        | { kind: 'looksRight' },
    ) => {
      if (!selectedId) return
      if (
        change.kind === 'status' &&
        change.status === 'not_venue' &&
        selectedId.startsWith(ADDED_PREFIX)
      )
        return
      void save(
        selectedId,
        nextReview(reviews.get(selectedId), selectedId, change, today()),
      )
    },
    [save, selectedId, reviews],
  )

  const startPinning = useCallback(() => {
    if (!selectedId) return
    if (pinning) return setPinning(false)
    if (reviews.get(selectedId)?.status !== 'terrace') {
      change({ kind: 'status', status: 'terrace' })
    }
    setPinning(true)
  }, [selectedId, pinning, reviews, change])

  // Y: right as it is. A terrace stays where it is; a venue without one is
  // marked "no terrace". Either way it leaves "To review" and "Needs a look".
  const hasTerrace = terrace !== null
  const markLooksRight = useCallback(() => {
    setPinning(false)
    change(
      hasTerrace
        ? { kind: 'looksRight' }
        : { kind: 'status', status: 'no_terrace' },
    )
  }, [change, hasTerrace])

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
    [selectedId, change, queueMode, advance],
  )

  const looksRightAndGo = useCallback(() => {
    if (!selectedId) return
    markLooksRight()
    if (queueMode) advance(selectedId)
  }, [selectedId, markLooksRight, queueMode, advance])

  const selectedProposals = useMemo(
    () => (selectedId ? (proposals.get(selectedId) ?? []) : []),
    [proposals, selectedId],
  )

  const acceptProposal = useCallback(
    (p: Proposal) => {
      if (p.kind === 'not_venue' && p.venueId.startsWith(ADDED_PREFIX)) return
      setPinning(false)
      void save(
        p.venueId,
        nextReview(reviews.get(p.venueId), p.venueId, acceptChange(p), today()),
      )
      // A corrected position still needs the terrace decision.
      if (queueMode && p.kind !== 'position' && p.venueId === selectedId)
        advance(p.venueId)
    },
    [save, reviews, queueMode, selectedId, advance],
  )

  const ignoreProposal = useCallback(async (p: Proposal) => {
    const key = proposalKey(p)
    setProposalData((current) => ({
      ...current,
      ignored: [...current.ignored, key],
    }))
    try {
      const response = await fetch(PROPOSALS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      if (!response.ok) throw new Error(await response.text())
      setMessage('Proposal ignored')
    } catch (error) {
      setMessage(`Not saved: ${String(error)}`)
      setProposalData(await fetchProposals().catch(() => NO_PROPOSALS))
    }
  }, [])

  const openQueue = () => {
    if (queueMode) return setQueueMode(false)
    setAdding(null)
    setQueueMode(true)
    setQueueBase(new Set(queue.map((s) => s.venue.id)))
    select(queue[0]?.venue.id ?? null)
  }

  // Batch "not a venue": staged for DISMISS_UNDO_MS, then saved one by one
  // through the usual save path.
  const commitDismiss = useCallback(
    async (ids: string[]) => {
      // Still staged (left out of the list) while the rows are written.
      setDismissing({ ids, until: 0, saving: true })
      const saved = await saveAll(
        ids.map((venueId) => ({
          venueId,
          next: nextReview(
            undefined,
            venueId,
            { kind: 'status', status: 'not_venue' },
            today(),
          ),
        })),
      )
      setDismissing(null)
      if (saved) setMessage(`Marked ${ids.length} as not a venue`)
    },
    [saveAll],
  )

  useEffect(() => {
    if (!dismissing || dismissing.saving) return
    const timer = window.setTimeout(
      () => void commitDismiss(dismissing.ids),
      Math.max(0, dismissing.until - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [dismissing, commitDismiss])

  const nextToReview = useCallback(() => {
    const start = venues.findIndex((v) => v.id === selectedId)
    const order = [...venues.slice(start + 1), ...venues.slice(0, start + 1)]
    const next = order.find((v) => !reviews.get(v.id)?.status)
    if (next) select(next.id)
  }, [venues, reviews, selectedId, select])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement
      )
        return
      if (adding) {
        if (event.key === 'Escape') setAdding(null)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'escape') {
        if (pinning) setPinning(false)
        else select(null)
      } else if (key === 'j') {
        if (queueMode) skip()
        else nextToReview()
      } else if (key === 's' && queueMode) skip()
      else if (key === 'enter' && queueMode && pinning && selectedId) {
        // Keeps the venue position as the terrace.
        setPinning(false)
        advance(selectedId)
      } else if (key === 't') startPinning()
      else if (key === 'n') decide('no_terrace')
      else if (key === 'x') decide('not_venue')
      else if (key === 'y') looksRightAndGo()
      else if (key === 'a' && selectedProposals[0])
        acceptProposal(selectedProposals[0])
      else if (key === 'i' && selectedProposals[0])
        void ignoreProposal(selectedProposals[0])
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    nextToReview,
    adding,
    pinning,
    select,
    startPinning,
    queueMode,
    skip,
    selectedId,
    advance,
    decide,
    looksRightAndGo,
    selectedProposals,
    acceptProposal,
    ignoreProposal,
  ])

  const startAdding = () => {
    setQueueMode(false)
    select(null)
    setAdding({ name: '', kind: 'bar', at: null })
  }

  const saveAdded = () => {
    const name = cleanName(adding?.name ?? '')
    if (!adding?.at || !name) return
    const venueId = addedId(name, new Set(venues.map((v) => v.id)))
    void save(venueId, {
      venueId,
      status: null,
      name,
      kind: adding.kind,
      venue: adding.at,
      terrace: null,
      reviewed: today(),
      looksRight: false,
    })
    setAdding(null)
    select(venueId)
  }

  const onMapClick = (at: LatLon) => {
    if (adding) setAdding({ ...adding, at })
    else if (selectedId && pinning) {
      change({ kind: 'terrace', at })
      setPinning(false)
      if (queueMode) advance(selectedId)
    } else if (!queueMode) select(null)
  }

  const runPublish = async () => {
    try {
      const response = await fetch(PUBLISH_API, { method: 'POST' })
      const parsed = publishStatusSchema.safeParse(await response.json())
      if (parsed.success) setPublish(parsed.data)
      else
        setPublish({
          ...IDLE,
          step: 'failed',
          error: 'a Publish is still building',
        })
    } catch (error) {
      setPublish({ ...IDLE, step: 'failed', error: String(error) })
    }
  }

  const acceptSuggestion = async (g: SuggestionGroup) => {
    const brand = BRANDS.find((b) => b === g.brand) ?? null
    const price: VenuePrice = {
      venueId: g.venue_id,
      item: g.item,
      brand,
      cents: g.cents,
      seen: g.last.slice(0, 10),
    }
    await savePrice(priceKey(price), price)
  }

  const reviewed = venues.filter((v) => reviews.get(v.id)?.status).length

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

  const ghosts = useMemo<Ghost[]>(
    () =>
      selectedProposals.flatMap((p) =>
        p.at && (p.kind === 'terrace' || p.kind === 'position')
          ? [
              {
                at: p.at,
                kind: p.kind,
                label: `Proposal: ${p.kind === 'terrace' ? 'terrace' : 'venue'} here (${Math.round(p.confidence * 100)} %)`,
              },
            ]
          : [],
      ),
    [selectedProposals],
  )
  const osm = selectedId ? osmUrl(selectedId) : null

  return (
    <div className="admin">
      <aside className="admin-side">
        <header className="admin-head">
          <div className="admin-title">
            <h1>Venue review</h1>
            <span className="admin-title-actions">
              <button
                type="button"
                aria-pressed={queueMode}
                onClick={openQueue}
              >
                Review queue
              </button>
              <button
                type="button"
                aria-pressed={junkOpen}
                onClick={() => setJunkOpen(!junkOpen)}
              >
                Not venues ({junk.length})
              </button>
              <button
                type="button"
                aria-pressed={queueOpen}
                onClick={() => setQueueOpen(!queueOpen)}
              >
                Suggestions
              </button>
              <button
                type="button"
                aria-pressed={candidatesOpen}
                onClick={() => setCandidatesOpen(!candidatesOpen)}
              >
                Website prices
              </button>
              <button type="button" onClick={startAdding}>
                + Add venue
              </button>
            </span>
          </div>
          <p>
            {reviewed} of {venues.length} reviewed
            {message && <span className="admin-message"> · {message}</span>}
          </p>
          <div className="admin-publish" aria-live="polite">
            <button
              type="button"
              disabled={isBusy(publish)}
              onClick={() => void runPublish()}
            >
              {isBusy(publish) ? 'Publishing…' : 'Publish'}
            </button>
            <p className={`admin-publish-${publish.step}`}>
              {isActive(publish) && <span className="admin-spinner" />}
              {describe(publish)}{' '}
              {publish.url && (
                <a href={publish.url} target="_blank" rel="noreferrer">
                  {publish.pr ? 'Open PR' : 'GitHub'}
                </a>
              )}
            </p>
            {isActive(publish) && (
              <p>
                You can keep editing: new changes go out with the next Publish.
              </p>
            )}
          </div>
          {queueOpen && (
            <SuggestionsQueue
              nameOf={(id) => venues.find((v) => v.id === id)?.name ?? id}
              onSelect={select}
              onAccept={acceptSuggestion}
            />
          )}
          {dismissing?.saving && (
            <div className="admin-dismissing" role="status">
              Saving {dismissing.ids.length} as not a venue…
            </div>
          )}
          {dismissing && !dismissing.saving && (
            <div className="admin-dismissing" role="status">
              <span>
                {dismissing.ids.length} will be marked not a venue in a few
                seconds.
              </span>
              <span className="admin-actions">
                <button type="button" onClick={() => setDismissing(null)}>
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => void commitDismiss(dismissing.ids)}
                >
                  Save now
                </button>
              </span>
            </div>
          )}
          {junkOpen && (
            <BatchDismiss
              items={junk}
              onSelect={select}
              onMark={(ids) =>
                setDismissing({
                  ids,
                  until: Date.now() + DISMISS_UNDO_MS,
                  saving: false,
                })
              }
            />
          )}
          {proposalData.errors.length > 0 && (
            <details className="admin-help">
              <summary>
                {proposalData.errors.length} rows of venue_proposals.csv skipped
              </summary>
              <ul className="admin-candidate-leads">
                {proposalData.errors.slice(0, 20).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </details>
          )}
          {candidatesOpen && (
            <PriceCandidates
              nameOf={(id) => venues.find((v) => v.id === id)?.name ?? id}
              onSelect={select}
              onAccept={(price) => savePrice(priceKey(price), price)}
            />
          )}
          {queueMode ? (
            <div className="admin-progress" aria-live="polite">
              <p>
                <strong>
                  {Math.min(progress.done + 1, progress.total)} of{' '}
                  {progress.total}
                </strong>
                , {progress.percent} % · {progress.value} % of the value
              </p>
              <div className="admin-progress-bar">
                <span style={{ width: `${progress.value}%` }} />
              </div>
            </div>
          ) : (
            <input
              type="search"
              placeholder="Search by name"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {!queueMode && (
            <div className="admin-filters" role="tablist">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                  {f.id === 'look' && ` (${looks.size})`}
                </button>
              ))}
            </div>
          )}
        </header>
        {queueMode && (
          <ol className="admin-list admin-queue-list">
            {queue.map((s, index) => (
              <li key={s.venue.id}>
                <button
                  type="button"
                  aria-current={s.venue.id === selectedId ? 'true' : undefined}
                  onClick={() => select(s.venue.id)}
                >
                  <span className="admin-rank">{index + 1}</span>
                  <span className="admin-name">
                    {s.venue.name}
                    <span className="admin-reason">
                      {skipped.includes(s.venue.id) ? 'Skipped · ' : ''}
                      {s.reason}
                    </span>
                  </span>
                  <span className="admin-kind">{s.venue.kind}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {!queueMode && (
          <ol className="admin-list">
            {listed.map((v) => {
              const state = stateOf(v, reviews.get(v.id))
              return (
                <li key={v.id}>
                  <button
                    type="button"
                    aria-current={v.id === selectedId ? 'true' : undefined}
                    onClick={() => select(v.id)}
                  >
                    <span
                      className="admin-dot"
                      style={{ background: STATE_COLORS[state] }}
                      title={STATE_LABELS[state]}
                    />
                    <span className="admin-name">
                      {v.name}
                      {filter === 'look' && (
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
        )}
      </aside>
      <main className="admin-main">
        <AdminMap
          venues={mapShown}
          selected={selectedMap}
          terrace={terrace}
          pinning={pinning}
          onSelect={(id) => {
            if (!adding) select(id)
          }}
          onMapClick={onMapClick}
          onPinTerrace={(at) => {
            change({ kind: 'terrace', at })
            setPinning(false)
            setDragging(null)
            if (queueMode && selectedId) advance(selectedId)
          }}
          ghosts={ghosts}
          onDragTerrace={setDragging}
          onMoveVenue={(at) =>
            adding
              ? setAdding({ ...adding, at })
              : change({ kind: 'venue', at })
          }
        />
        {adding && (
          <section className="admin-panel" aria-label="Add a venue">
            <h2>Add a venue</h2>
            <p className="admin-help">
              For a bar or restaurant that is missing from the list. Click the
              map where it is, then name it.
            </p>
            <label className="admin-field">
              Name
              <input
                autoFocus
                value={adding.name}
                onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveAdded()
                  if (e.key === 'Escape') setAdding(null)
                }}
              />
            </label>
            <label className="admin-field">
              Kind
              <select
                value={adding.kind}
                onChange={(e) => {
                  const kind = KINDS.find((k) => k === e.target.value)
                  if (kind) setAdding({ ...adding, kind })
                }}
              >
                {KINDS.map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
            <p className="admin-meta">
              {adding.at
                ? 'Placed. Drag the pin or click again to adjust.'
                : 'Not placed yet: click the map.'}
            </p>
            <div className="admin-actions">
              <button
                type="button"
                disabled={!adding.at || !cleanName(adding.name)}
                onClick={saveAdded}
              >
                Save venue
              </button>
              <button type="button" onClick={() => setAdding(null)}>
                Cancel
              </button>
            </div>
          </section>
        )}
        {queueMode && !adding && !selectedVenue && (
          <section className="admin-panel" aria-label="Review queue">
            <h2>Review queue</h2>
            <p className="admin-help">
              {queue.length === 0
                ? 'Nothing left to review.'
                : 'Pick a venue from the list to carry on.'}
            </p>
          </section>
        )}
        {!adding && selectedVenue && selectedMap && (
          <section className="admin-panel" aria-label="Selected venue">
            {queueMode && (
              <p className="admin-queue-head">
                Review queue · {Math.min(progress.done + 1, progress.total)} of{' '}
                {progress.total}
                {queueItem && (
                  <span className="admin-reason"> {queueItem.reason}</span>
                )}
              </p>
            )}
            <h2>{selectedVenue.name}</h2>
            <p className="admin-meta">
              {selectedVenue.kind} · {selectedVenue.sources.join(', ')} ·{' '}
              {STATE_LABELS[selectedMap.state]}
              {review?.venue &&
                !selectedVenue.id.startsWith(ADDED_PREFIX) &&
                ' · moved'}
              {review?.looksRight && ' · looks right'}
            </p>
            <p className="admin-meta">
              {osm ? (
                <a href={osm} target="_blank" rel="noreferrer">
                  {selectedVenue.id}
                </a>
              ) : (
                selectedVenue.id
              )}
            </p>
            <ProposalBox
              proposals={selectedProposals}
              onAccept={acceptProposal}
              onIgnore={(p) => void ignoreProposal(p)}
            />
            <div
              className={
                queueMode ? 'admin-actions admin-actions-big' : 'admin-actions'
              }
            >
              <button
                type="button"
                aria-pressed={review?.status === 'terrace'}
                onClick={startPinning}
              >
                Terrace <kbd>T</kbd>
              </button>
              <button
                type="button"
                aria-pressed={review?.status === 'no_terrace'}
                onClick={() => decide('no_terrace')}
              >
                No terrace <kbd>N</kbd>
              </button>
              {!selectedVenue.id.startsWith(ADDED_PREFIX) && (
                <button
                  type="button"
                  aria-pressed={review?.status === 'not_venue'}
                  onClick={() => decide('not_venue')}
                >
                  Not a venue <kbd>X</kbd>
                </button>
              )}
              <button
                type="button"
                aria-pressed={review?.looksRight === true}
                title="Right as it is: keeps the terrace where it is (or no terrace) and leaves Needs a look"
                onClick={looksRightAndGo}
              >
                Looks right <kbd>Y</kbd>
              </button>
              {queueMode && (
                <button type="button" onClick={skip}>
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
                      onClick={() => {
                        setPinning(false)
                        if (selectedId) advance(selectedId)
                      }}
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
                Each decision moves on to the next venue. T then a click on the
                map pins the terrace; Y keeps what the data says; Skip puts the
                venue at the end.
              </p>
            ) : (
              <p className="admin-help">
                T marks a terrace and lets you place its pin with one click;
                press T again to move it. Drag the dark pin to fix the venue
                position.
              </p>
            )}
            {preview && <SunPreview at={preview} />}
            <h3 className="admin-subhead">Beer prices</h3>
            <PricesEditor
              key={selectedVenue.id}
              venueId={selectedVenue.id}
              prices={[...prices.values()].filter(
                (p) => p.venueId === selectedVenue.id,
              )}
              today={today()}
              onSave={(p) => void savePrice(priceKey(p), p)}
              onRemove={(key) => void savePrice(key, null)}
            />
            <div className="admin-actions">
              {!queueMode && (
                <button type="button" onClick={nextToReview}>
                  Next to review <kbd>J</kbd>
                </button>
              )}
              {review && (
                <button
                  type="button"
                  onClick={() => void save(selectedVenue.id, null)}
                >
                  {selectedVenue.id.startsWith(ADDED_PREFIX)
                    ? 'Delete venue'
                    : 'Undo review'}
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

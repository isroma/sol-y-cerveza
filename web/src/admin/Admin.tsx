import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { AddVenuePanel, type Adding } from './AddVenuePanel.tsx'
import { AdminMap } from './AdminMap.tsx'
import { AdminToolbar } from './AdminToolbar.tsx'
import { PriceCandidates } from './PriceCandidates.tsx'
import { SuggestionsQueue } from './SuggestionsQueue.tsx'
import { ReportsQueue } from './ReportsQueue.tsx'
import { fetchReports, type VenueReport } from './reports.ts'
import { useOwnerChanges } from './useOwnerChanges.ts'
import { priceKey } from './pricesCsv.ts'
import { stateOf, type MapVenue } from './mapState.ts'
import { dayTrack } from '../sun/dayTrack.ts'
import { toMadridLocal } from '../time/madrid.ts'
import { needsALook, referenceDates, type LookReason } from './needsLook.ts'
import { BADAJOZ_CENTER } from '../config.ts'
import { BatchDismiss } from './BatchDismiss.tsx'
import { junkSignalsAll, likelyJunk } from './junk.ts'
import { acceptChange, openProposals, type Proposal } from './proposals.ts'
import { scoreVenues } from './queueScore.ts'
import type { Ghost } from './AdminMap.tsx'
import {
  ADDED_PREFIX,
  addedId,
  cleanName,
  nextReview,
  type Review,
} from './review.ts'
import {
  IDLE,
  isActive,
  publishStatusSchema,
  type PublishStatus,
} from './publishStatus.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'
import { today } from './today.ts'
import { useAdminData } from './useAdminData.ts'
import { useReportActions } from './useReportActions.ts'
import { useReviewQueue } from './useReviewQueue.ts'
import { VenueListPanel } from './VenueListPanel.tsx'
import { VenuePanel } from './VenuePanel.tsx'

const CENTRE: LatLon = { lat: BADAJOZ_CENTER[1], lon: BADAJOZ_CENTER[0] }
/** How long a batch "not a venue" waits for Undo before it is saved. */
const DISMISS_UNDO_MS = 10_000

type Filter = 'todo' | 'not_venue' | 'all' | 'look'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To review' },
  { id: 'not_venue', label: 'Not a venue' },
  { id: 'all', label: 'All' },
  { id: 'look', label: 'Needs a look' },
]

function matches(filter: Filter, review: Review | undefined): boolean {
  if (filter === 'all' || filter === 'look') return true
  if (filter === 'todo') return !review?.status
  return review?.status === filter
}

export function Admin() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const {
    dataVenues,
    dropped,
    venues,
    reviews,
    prices,
    message,
    setMessage,
    proposalData,
    saveAll,
    save,
    savePrice,
    change,
    ignoreProposal,
  } = useAdminData(selectedId)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('todo')
  const [pinning, setPinning] = useState(false)
  // The terrace pin while it is being dragged, for a live sun preview.
  const [dragging, setDragging] = useState<LatLon | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [candidatesOpen, setCandidatesOpen] = useState(false)
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportCount, setReportCount] = useState<number | null>(null)
  // Where a selected visitor report would put a venue.
  const [proposed, setProposed] = useState<LatLon | null>(null)
  const [publish, setPublish] = useState<PublishStatus>(IDLE)
  const [junkOpen, setJunkOpen] = useState(false)
  const [dismissing, setDismissing] = useState<{
    ids: string[]
    until: number
    saving: boolean
  } | null>(null)

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    setPinning(false)
    setDragging(null)
    setProposed(null)
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

  // Picks up a Publish already running (e.g. after a reload), then follows it.
  const active = isActive(publish)
  useEffect(() => {
    let stop = false
    const poll = async () => {
      try {
        const response = await fetch(ADMIN_ENDPOINTS.publish)
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

  // Review queue: venues one at a time, best value first (queueScore.ts).
  const {
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
  } = useReviewQueue({
    venues,
    reviews,
    scored,
    selectedId,
    select,
    change,
    setPinning,
    markLooksRight,
  })

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

  const openQueue = () => {
    if (queueMode) return setQueueMode(false)
    setAdding(null)
    startQueue()
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
    [saveAll, setMessage],
  )

  useEffect(() => {
    if (!dismissing || dismissing.saving) return
    const timer = window.setTimeout(
      () => void commitDismiss(dismissing.ids),
      Math.max(0, dismissing.until - Date.now()),
    )
    return () => window.clearTimeout(timer)
  }, [dismissing, commitDismiss])

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
      // JSON, like every admin write (adminGuard.ts); the body is unused.
      const response = await fetch(ADMIN_ENDPOINTS.publish, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
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

  const { acceptReport, acceptSuggestion } = useReportActions({
    venues,
    reviews,
    save,
    savePrice,
    onReportSaved: () => setProposed(null),
  })

  // Changes the owner made from the phone are applied as the admin opens.
  useOwnerChanges({
    ready: dataVenues.length > 0,
    accept: acceptReport,
    onDone: (applied, problems) => {
      setMessage(
        [
          applied > 0 &&
            `Applied ${applied} change${applied === 1 ? '' : 's'} from owner mode: Publish to ship them.`,
          problems.length > 0 &&
            `${problems.length} owner change${problems.length === 1 ? '' : 's'} not applied (${problems.join('; ')}); they stay in Reports.`,
        ]
          .filter(Boolean)
          .join(' '),
      )
      void fetchReports().then((r) => {
        if (r.reports) setReportCount(r.reports.length)
      })
    },
  })

  // Pending reports, for the count on the Reports button.
  useEffect(() => {
    void fetchReports().then((r) => {
      if (r.reports) setReportCount(r.reports.length)
    })
  }, [])

  const selectReport = (r: VenueReport) => {
    if (r.kind === 'add') {
      setAdding(null)
      select(null)
    } else select(r.venueId)
    if ('lat' in r) setProposed({ lat: r.lat, lon: r.lon })
  }

  const reviewed = venues.filter((v) => reviews.get(v.id)?.status).length

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

  return (
    <div className="admin">
      <aside className="admin-side">
        <header className="admin-head">
          <AdminToolbar
            queueMode={queueMode}
            onQueue={openQueue}
            junkOpen={junkOpen}
            junkCount={junk.length}
            onJunk={() => setJunkOpen(!junkOpen)}
            suggestionsOpen={queueOpen}
            onSuggestions={() => setQueueOpen(!queueOpen)}
            reportsOpen={reportsOpen}
            reportCount={reportCount}
            onReports={() => {
              setReportsOpen(!reportsOpen)
              setProposed(null)
            }}
            candidatesOpen={candidatesOpen}
            onCandidates={() => setCandidatesOpen(!candidatesOpen)}
            onAdd={startAdding}
            reviewed={reviewed}
            total={venues.length}
            dropped={dropped}
            message={message}
            publish={publish}
            onPublish={() => void runPublish()}
          />
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
          {reportsOpen && (
            <ReportsQueue
              venueOf={(id) => mapVenues.find((v) => v.id === id)}
              onSelect={selectReport}
              onAccept={acceptReport}
              onCount={setReportCount}
            />
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
          <VenueListPanel
            venues={listed}
            reviews={reviews}
            selectedId={selectedId}
            onSelect={select}
            looks={filter === 'look' ? looks : null}
            pinMoved={pinMoved}
          />
        )}
      </aside>
      <main className="admin-main">
        <AdminMap
          venues={mapShown}
          selected={selectedMap}
          terrace={terrace}
          pinning={pinning}
          proposed={proposed}
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
          <AddVenuePanel
            adding={adding}
            onChange={setAdding}
            onSave={saveAdded}
            onCancel={() => setAdding(null)}
          />
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
          <VenuePanel
            venue={selectedVenue}
            state={selectedMap.state}
            review={review}
            queueMode={queueMode}
            progress={progress}
            queueReason={queueItem?.reason ?? null}
            proposals={selectedProposals}
            onAcceptProposal={acceptProposal}
            onIgnoreProposal={(p) => void ignoreProposal(p)}
            onTerrace={startPinning}
            onDecide={decide}
            onLooksRight={looksRightAndGo}
            onSkip={skip}
            pinning={pinning}
            onKeepPosition={() => {
              setPinning(false)
              if (selectedId) advance(selectedId)
            }}
            preview={preview}
            prices={[...prices.values()].filter(
              (p) => p.venueId === selectedVenue.id,
            )}
            onSavePrice={(key, next) => void savePrice(key, next)}
            onNextToReview={nextToReview}
            onUndo={() => void save(selectedVenue.id, null)}
          />
        )}
      </main>
    </div>
  )
}

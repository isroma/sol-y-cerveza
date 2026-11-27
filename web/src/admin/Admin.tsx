import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LatLon } from '../data/terraces.ts'
import { AddVenuePanel, type Adding } from './AddVenuePanel.tsx'
import { AdminMap } from './AdminMap.tsx'
import { AdminToolbar } from './AdminToolbar.tsx'
import { InboxFilters, InboxList } from './InboxList.tsx'
import { answerForKey } from './inbox.ts'
import { InboxPanel } from './InboxPanel.tsx'
import { QueueList } from './QueueList.tsx'
import { useInbox } from './useInbox.ts'
import { useOwnerChanges } from './useOwnerChanges.ts'
import { priceKey } from './pricesCsv.ts'
import { stateOf, type MapVenue } from './mapState.ts'
import { dayTrack } from '../sun/dayTrack.ts'
import { isLeafOff } from '../sun/leafOff.ts'
import { toMadridLocal } from '../time/madrid.ts'
import { needsALook, referenceDates, type LookReason } from './needsLook.ts'
import { BADAJOZ_CENTER } from '../config.ts'
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
import { sunCells } from './sunCells.ts'
import { useProbe } from './useProbe.ts'

const CENTRE: LatLon = { lat: BADAJOZ_CENTER[1], lon: BADAJOZ_CENTER[0] }

type Filter = 'todo' | 'not_venue' | 'all' | 'look'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To review' },
  { id: 'look', label: 'Needs a look' },
  { id: 'not_venue', label: 'Not a venue' },
  { id: 'all', label: 'All' },
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
    trust,
    trustMissing,
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
  // The sidebar's two tabs: the venues to review, or the Inbox.
  const [tab, setTab] = useState<'review' | 'inbox'>('review')
  // Where a selected visitor report would put a venue.
  const [proposed, setProposed] = useState<LatLon | null>(null)
  const [publish, setPublish] = useState<PublishStatus>(IDLE)

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
  // Overture venues from a weak source: the queue shows them first (trust.ts).
  const weak = useMemo(
    () =>
      new Set(
        [...trust.values()]
          .filter((t) => t.tier === 'weak')
          .map((t) => t.venueId),
      ),
    [trust],
  )
  const scored = useMemo(
    () => scoreVenues(venues, reviews, proposals, CENTRE, junkSignals),
    [venues, reviews, proposals, junkSignals],
  )
  const junk = useMemo(
    () => likelyJunk(venues, reviews, junkSignals),
    [venues, reviews, junkSignals],
  )

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
  // One probe for the panel's sun preview and the map's cells (the dev server
  // runs one at a time).
  const sun = useProbe(preview)
  const [sunDate] = useState(() => toMadridLocal(new Date()).date)
  const sunTrack = useMemo(() => dayTrack(sunDate), [sunDate])
  // Read each render: the leaf-off dates arrive with the data.
  const sunLeafOff = isLeafOff(sunDate)
  const hasPin = preview !== null
  const outcome = sun.outcome
  const cells = useMemo(
    () =>
      hasPin && outcome?.kind === 'ok'
        ? sunCells(outcome.result, sunTrack, sunLeafOff)
        : null,
    [hasPin, outcome, sunTrack, sunLeafOff],
  )

  // Moving the pin changes the terrace; the dataset horizon no longer applies.
  const pinMoved = useCallback(
    (id: string): boolean => {
      const pinned = reviews.get(id)?.terrace
      const data = venues.find((v) => v.id === id)?.terrace
      return !!pinned && (pinned.lat !== data?.lat || pinned.lon !== data.lon)
    },
    [reviews, venues],
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

  // Review queue: venues one at a time, best value first (queueScore.ts).
  // "To review" with no search is the review queue, best value first.
  const queueMode = filter === 'todo' && query.trim() === ''
  const {
    skipped,
    queue,
    queueItem,
    advance,
    skip,
    decide,
    looksRightAndGo,
    nextToReview,
  } = useReviewQueue({
    queueMode,
    venues,
    reviews,
    scored,
    weak,
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

  const { acceptReport, acceptSuggestion } = useReportActions({
    venues,
    reviews,
    save,
    savePrice,
    onReportSaved: () => setProposed(null),
  })

  // The Inbox tab: each answer moves on to its next item.
  const inbox = useInbox({
    junk,
    show: (venueId, point) => {
      setAdding(null)
      select(venueId)
      setProposed(point)
    },
    acceptReport,
    acceptSuggestion,
    savePrice: (price) => savePrice(priceKey(price), price),
    markNotVenue: (venueId) =>
      save(
        venueId,
        nextReview(
          undefined,
          venueId,
          { kind: 'status', status: 'not_venue' },
          today(),
        ),
      ),
    onSunRecorded: (added) =>
      setMessage(
        `Recorded ${added} accepted sun report${added === 1 ? '' : 's'} in sun_corrections.csv: Publish to ship ${added === 1 ? 'it' : 'them'}.`,
      ),
  })

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
      if (tab === 'inbox') {
        const open = inbox.open
        const answer = open && !inbox.busy ? answerForKey(open.kind, key) : null
        if (key === 'escape') inbox.openItem(null)
        else if (open && answer) void inbox.answer(open, answer)
        else return
        event.preventDefault()
        return
      }
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
    tab,
    inbox,
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
    } else select(null)
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
      void inbox.reload()
    },
  })

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
            reviewed={reviewed}
            total={venues.length}
            dropped={dropped}
            message={message}
            publish={publish}
            onPublish={() => void runPublish()}
          />
          <div className="admin-tabs" role="tablist" aria-label="Sidebar">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'review'}
              onClick={() => {
                setTab('review')
                inbox.openItem(null)
              }}
            >
              To review <span>{queue.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'inbox'}
              onClick={() => {
                setTab('inbox')
                setAdding(null)
                select(null)
              }}
            >
              Inbox <span>{inbox.items.length}</span>
            </button>
          </div>
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
          {tab === 'review' ? (
            <>
              <div className="admin-search">
                <input
                  type="search"
                  placeholder="Search by name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Add a venue"
                  title="Add a venue no source lists"
                  onClick={startAdding}
                >
                  +
                </button>
              </div>
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
            </>
          ) : (
            <InboxFilters
              items={inbox.items}
              filter={inbox.filter}
              onFilter={inbox.setFilter}
            />
          )}
        </header>
        {tab === 'review' && queueMode && (
          <QueueList
            queue={queue}
            trust={trust}
            trustMissing={trustMissing}
            skipped={skipped}
            selectedId={selectedId}
            onSelect={select}
          />
        )}
        {tab === 'review' && !queueMode && (
          <VenueListPanel
            venues={listed}
            reviews={reviews}
            selectedId={selectedId}
            onSelect={select}
            looks={filter === 'look' ? looks : null}
            pinMoved={pinMoved}
          />
        )}
        {tab === 'inbox' && (
          <InboxList
            shown={inbox.shown}
            filter={inbox.filter}
            openKey={inbox.open?.key ?? null}
            onOpen={inbox.openItem}
            venueOf={(id) => mapVenues.find((v) => v.id === id)}
            loaded={inbox.loaded}
            errors={inbox.errors}
            leads={inbox.leads}
          />
        )}
      </aside>
      <main className="admin-main">
        <AdminMap
          venues={mapShown}
          selected={selectedMap}
          terrace={terrace}
          sunCells={cells}
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
        {tab === 'inbox' && inbox.open && (
          <InboxPanel
            item={inbox.open}
            position={inbox.shown.indexOf(inbox.open) + 1}
            total={inbox.shown.length}
            venueOf={(id) => mapVenues.find((v) => v.id === id)}
            terraceOf={(id) => dataVenues.find((v) => v.id === id)}
            pinMoved={pinMoved}
            onMovePin={(id) => {
              // To review, on the venue, outside the queue (so a decision
              // does not move on); the report stays in the Inbox.
              setTab('review')
              inbox.openItem(null)
              setQuery('')
              setFilter('all')
              select(id)
            }}
            busy={inbox.busy}
            failure={inbox.failure}
            onAnswer={(choice) => {
              if (inbox.open) void inbox.answer(inbox.open, choice)
            }}
          />
        )}
        {tab === 'review' &&
          queueMode &&
          !adding &&
          !selectedVenue &&
          queue.length === 0 && (
            <section className="admin-panel" aria-label="Review queue">
              <h2>Nothing left to review</h2>
            </section>
          )}
        {tab === 'review' && !adding && selectedVenue && selectedMap && (
          <VenuePanel
            venue={selectedVenue}
            state={selectedMap.state}
            review={review}
            queueMode={queueMode}
            queueReason={queueItem?.reason ?? null}
            trust={trust.get(selectedVenue.id)}
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
            sun={preview ? sun : null}
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

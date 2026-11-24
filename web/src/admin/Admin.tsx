import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { AdminMap } from './AdminMap.tsx'
import { PricesEditor } from './PricesEditor.tsx'
import { PriceCandidates } from './PriceCandidates.tsx'
import { SuggestionsQueue, type SuggestionGroup } from './SuggestionsQueue.tsx'
import { ReportsQueue } from './ReportsQueue.tsx'
import { fetchReports, type VenueReport } from './reports.ts'
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
  const [reportsOpen, setReportsOpen] = useState(false)
  const [reportCount, setReportCount] = useState<number | null>(null)
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

  useEffect(() => {
    Promise.all([loadTerraces(), fetchReviews(), fetchPrices()])
      .then(([file, rows, priceRows]) => {
        setVenues(file.terraces)
        setReviews(rows)
        setPrices(priceRows)
        setMessage('')
      })
      .catch((error: unknown) => setMessage(String(error)))
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

  const save = useCallback(async (venueId: string, next: Review | null) => {
    setReviews((current) => {
      const copy = new Map(current)
      if (next) copy.set(venueId, next)
      else copy.delete(venueId)
      return copy
    })
    try {
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
      setMessage('Saved')
      return true
    } catch (error) {
      setMessage(`Not saved: ${String(error)}`)
      setReviews(await fetchReviews())
      return false
    }
  }, [])

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
      } else if (key === 'j') nextToReview()
      else if (key === 't') startPinning()
      else if (key === 'n') {
        setPinning(false)
        change({ kind: 'status', status: 'no_terrace' })
      } else if (key === 'x') {
        setPinning(false)
        change({ kind: 'status', status: 'not_venue' })
      } else if (key === 'y') markLooksRight()
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    change,
    nextToReview,
    adding,
    pinning,
    select,
    startPinning,
    markLooksRight,
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
    } else select(null)
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
    if (r.kind !== 'closed') setProposed({ lat: r.lat, lon: r.lon })
  }

  /** Applies a visitor report through the review rows; true once saved. */
  const acceptReport = async (r: VenueReport): Promise<boolean> => {
    let saved: boolean
    if (r.kind === 'add') {
      const name = cleanName(r.name)
      const venueId = addedId(name, new Set(venues.map((v) => v.id)))
      saved = await save(venueId, {
        venueId,
        status: r.terrace ? 'terrace' : null,
        name,
        kind: r.venueKind,
        venue: { lat: r.lat, lon: r.lon },
        terrace: null,
        reviewed: today(),
        looksRight: false,
      })
    } else if (r.kind === 'closed' && r.venueId.startsWith(ADDED_PREFIX)) {
      saved = await save(r.venueId, null)
    } else {
      saved = await save(
        r.venueId,
        nextReview(
          reviews.get(r.venueId),
          r.venueId,
          r.kind === 'closed'
            ? { kind: 'status', status: 'not_venue' }
            : { kind: 'venue', at: { lat: r.lat, lon: r.lon } },
          today(),
        ),
      )
    }
    if (saved) setProposed(null)
    return saved
  }

  const reviewed = venues.filter((v) => reviews.get(v.id)?.status).length
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
                aria-pressed={queueOpen}
                onClick={() => setQueueOpen(!queueOpen)}
              >
                Suggestions
              </button>
              <button
                type="button"
                aria-pressed={reportsOpen}
                onClick={() => {
                  setReportsOpen(!reportsOpen)
                  setProposed(null)
                }}
              >
                Reports{reportCount ? ` (${reportCount})` : ''}
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
          <input
            type="search"
            placeholder="Search by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
        </header>
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
          }}
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
        {!adding && selectedVenue && selectedMap && (
          <section className="admin-panel" aria-label="Selected venue">
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
            <div className="admin-actions">
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
                onClick={() => {
                  setPinning(false)
                  change({ kind: 'status', status: 'no_terrace' })
                }}
              >
                No terrace <kbd>N</kbd>
              </button>
              {!selectedVenue.id.startsWith(ADDED_PREFIX) && (
                <button
                  type="button"
                  aria-pressed={review?.status === 'not_venue'}
                  onClick={() =>
                    change({ kind: 'status', status: 'not_venue' })
                  }
                >
                  Not a venue <kbd>X</kbd>
                </button>
              )}
              <button
                type="button"
                aria-pressed={review?.looksRight === true}
                title="Right as it is: keeps the terrace where it is (or no terrace) and leaves Needs a look"
                onClick={markLooksRight}
              >
                Looks right <kbd>Y</kbd>
              </button>
            </div>
            {pinning ? (
              <p className="admin-pin-mode">
                Click the map where the tables are. Esc cancels.
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
              <button type="button" onClick={nextToReview}>
                Next to review <kbd>J</kbd>
              </button>
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

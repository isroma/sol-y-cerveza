import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { AdminMap } from './AdminMap.tsx'
import { STATE_COLORS, type MapState, type MapVenue } from './mapState.ts'
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

type Filter = 'todo' | 'terrace' | 'no_terrace' | 'not_venue' | 'all'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To review' },
  { id: 'terrace', label: 'Terrace' },
  { id: 'no_terrace', label: 'No terrace' },
  { id: 'not_venue', label: 'Not a venue' },
  { id: 'all', label: 'All' },
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
  if (filter === 'all') return true
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
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('todo')
  const [message, setMessage] = useState('Loading…')
  const [pinning, setPinning] = useState(false)
  const [publish, setPublish] = useState<PublishStatus>(IDLE)

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    setPinning(false)
  }, [])

  useEffect(() => {
    Promise.all([loadTerraces(), fetchReviews()])
      .then(([file, rows]) => {
        setVenues(file.terraces)
        setReviews(rows)
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
        (!q || v.name.toLocaleLowerCase('es').includes(q)),
    )
  }, [venues, reviews, filter, query])

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
    } catch (error) {
      setMessage(`Not saved: ${String(error)}`)
      setReviews(await fetchReviews())
    }
  }, [])

  const change = useCallback(
    (
      change:
        | { kind: 'status'; status: Status }
        | { kind: 'terrace'; at: LatLon }
        | { kind: 'venue'; at: LatLon },
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
      } else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [change, nextToReview, adding, pinning, select, startPinning])

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

  const reviewed = venues.filter((v) => reviews.get(v.id)?.status).length
  const osm = selectedId ? osmUrl(selectedId) : null

  return (
    <div className="admin">
      <aside className="admin-side">
        <header className="admin-head">
          <div className="admin-title">
            <h1>Venue review</h1>
            <button type="button" onClick={startAdding}>
              + Add venue
            </button>
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
                  <span className="admin-name">{v.name}</span>
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
          onSelect={(id) => {
            if (!adding) select(id)
          }}
          onMapClick={onMapClick}
          onPinTerrace={(at) => {
            change({ kind: 'terrace', at })
            setPinning(false)
          }}
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

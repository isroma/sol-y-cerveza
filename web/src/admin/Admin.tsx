import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { AdminMap } from './AdminMap.tsx'
import { STATE_COLORS, type MapState, type MapVenue } from './mapState.ts'
import { nextReview, reviewSchema, type Review, type Status } from './review.ts'

const API = '/__admin/review'

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

async function fetchReviews(): Promise<Map<string, Review>> {
  const response = await fetch(API)
  if (!response.ok) throw new Error(`GET ${API}: HTTP ${response.status}`)
  const rows = reviewSchema.array().parse(await response.json())
  return new Map(rows.map((r) => [r.venueId, r]))
}

export function Admin() {
  const [venues, setVenues] = useState<Terrace[]>([])
  const [reviews, setReviews] = useState(new Map<string, Review>())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('todo')
  const [message, setMessage] = useState('Loading…')

  useEffect(() => {
    Promise.all([loadTerraces(), fetchReviews()])
      .then(([file, rows]) => {
        setVenues(
          [...file.terraces].sort((a, b) => a.name.localeCompare(b.name, 'es')),
        )
        setReviews(rows)
        setMessage('')
      })
      .catch((error: unknown) => setMessage(String(error)))
  }, [])

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

  const selectedVenue = venues.find((v) => v.id === selectedId) ?? null
  const selectedMap = mapVenues.find((v) => v.id === selectedId) ?? null
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
      void save(
        selectedId,
        nextReview(reviews.get(selectedId), selectedId, change, today()),
      )
    },
    [save, selectedId, reviews],
  )

  const nextToReview = useCallback(() => {
    const start = venues.findIndex((v) => v.id === selectedId)
    const order = [...venues.slice(start + 1), ...venues.slice(0, start + 1)]
    const next = order.find((v) => !reviews.get(v.id)?.status)
    if (next) setSelectedId(next.id)
  }, [venues, reviews, selectedId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 'escape') setSelectedId(null)
      else if (key === 'j') nextToReview()
      else if (key === 't') change({ kind: 'status', status: 'terrace' })
      else if (key === 'n') change({ kind: 'status', status: 'no_terrace' })
      else if (key === 'x') change({ kind: 'status', status: 'not_venue' })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [change, nextToReview])

  const reviewed = venues.filter((v) => reviews.get(v.id)?.status).length
  const osm = selectedId ? osmUrl(selectedId) : null

  return (
    <div className="admin">
      <aside className="admin-side">
        <header className="admin-head">
          <h1>Venue review</h1>
          <p>
            {reviewed} of {venues.length} reviewed
            {message && <span className="admin-message"> · {message}</span>}
          </p>
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
                  onClick={() => setSelectedId(v.id)}
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
          venues={mapVenues}
          selected={selectedMap}
          terrace={terrace}
          onSelect={setSelectedId}
          onPinTerrace={(at) => change({ kind: 'terrace', at })}
          onMoveVenue={(at) => change({ kind: 'venue', at })}
        />
        {selectedVenue && selectedMap && (
          <section className="admin-panel" aria-label="Selected venue">
            <h2>{selectedVenue.name}</h2>
            <p className="admin-meta">
              {selectedVenue.kind} · {selectedVenue.sources.join(', ')} ·{' '}
              {STATE_LABELS[selectedMap.state]}
              {review?.venue && ' · moved'}
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
                onClick={() => change({ kind: 'status', status: 'terrace' })}
              >
                Terrace <kbd>T</kbd>
              </button>
              <button
                type="button"
                aria-pressed={review?.status === 'no_terrace'}
                onClick={() => change({ kind: 'status', status: 'no_terrace' })}
              >
                No terrace <kbd>N</kbd>
              </button>
              <button
                type="button"
                aria-pressed={review?.status === 'not_venue'}
                onClick={() => change({ kind: 'status', status: 'not_venue' })}
              >
                Not a venue <kbd>X</kbd>
              </button>
            </div>
            <p className="admin-help">
              Click the map where the tables are to pin the terrace (marks it as
              a terrace). Drag the dark pin to fix the venue position.
            </p>
            <div className="admin-actions">
              <button type="button" onClick={nextToReview}>
                Next to review <kbd>J</kbd>
              </button>
              {review && (
                <button
                  type="button"
                  onClick={() => void save(selectedVenue.id, null)}
                >
                  Undo review
                </button>
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

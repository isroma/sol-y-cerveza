import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { loadTerraces, type LatLon, type Terrace } from '../data/terraces.ts'
import { AdminMap, type AdminMapControl } from './AdminMap.tsx'
import {
  applyEdits,
  priceEdit,
  PRICES_API,
  REVIEW_API as API,
  reviewEdit,
  type Outcome,
} from './editQueue.ts'
import { EditsWaiting } from './EditsWaiting.tsx'
import { byDistance, formatDistance } from './nearest.ts'
import { useEditQueue, type Rejected } from './useEditQueue.ts'
import { useLocate } from './useLocate.ts'
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

const PUBLISH_API = '/__admin/publish'
/** How many venues the phone's bottom bar offers once located. */
const NEARBY = 8
/** The phone layout's breakpoint, as in admin.css and the app. */
const PHONE = '(max-width: 899px)'

/** What to say after a save; a refused edit is reported by onRejected. */
function savedMessage(outcome: Outcome | 'queued'): string | null {
  if (outcome === 'saved') return 'Saved'
  if (outcome === 'queued') return 'Server unreachable: kept on this device'
  return null
}

type Filter = 'todo' | 'terrace' | 'no_terrace' | 'not_venue' | 'all' | 'look'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'To review' },
  { id: 'terrace', label: 'Terrace' },
  { id: 'no_terrace', label: 'No terrace' },
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
  if (response.status === 401)
    throw new Error(
      'LAN mode needs this run’s token: open the admin URL printed by npm run admin:lan',
    )
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
  // Phones: the venue list is a full-screen menu and the venue panel a
  // bottom sheet, collapsed to the name and status buttons until expanded.
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [nearFirst, setNearFirst] = useState(false)
  const mapControl = useRef<AdminMapControl | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const crosshairRef = useRef<HTMLDivElement>(null)

  const select = useCallback((id: string | null) => {
    setSelectedId(id)
    setPinning(false)
    setDragging(null)
    setMenuOpen(false)
  }, [])

  // Saves go through the offline queue: kept on the device while the dev
  // server is unreachable, replayed in order when it is back.
  const reloadRef = useRef<() => void>(() => undefined)
  const onRejected = useCallback((rejected: Rejected[]) => {
    const codes = rejected.map((r) => r.status).join(', ')
    const what = rejected.length === 1 ? 'an edit' : `${rejected.length} edits`
    setMessage(`Not saved: the server refused ${what} (HTTP ${codes})`)
    reloadRef.current()
  }, [])
  const edits = useEditQueue(onRejected)
  const { submit, flush, pending } = edits
  // Says so when the last waiting edit has gone through.
  const waitingCount = edits.queue.length
  const [wasWaiting, setWasWaiting] = useState(waitingCount > 0)
  if (waitingCount > 0 !== wasWaiting) {
    setWasWaiting(waitingCount > 0)
    if (waitingCount === 0) setMessage('All waiting edits saved')
  }

  // The server's reviews and prices, with the edits still waiting on top.
  const reload = useCallback(async () => {
    const [rows, priceRows] = await Promise.all([fetchReviews(), fetchPrices()])
    const local = applyEdits(rows, priceRows, pending())
    setReviews(local.reviews)
    setPrices(local.prices)
  }, [pending])
  useEffect(() => {
    reloadRef.current = () =>
      void reload().catch((error: unknown) => setMessage(String(error)))
  })

  // "Where am I": the first fix centres the map and sorts the list by distance.
  const locate = useLocate((fix) => {
    mapControl.current?.centerOn(fix.at)
    setNearFirst(true)
  })
  const onLocate = () => {
    if (locate.fix) {
      mapControl.current?.centerOn(locate.fix.at)
      setNearFirst(true)
    } else locate.start()
  }

  // Sun checks on the horizons in terraces.json, for the "Needs a look" filter.
  // Terraces reviewed away are left out; moved pins keep their stale horizon
  // until the next build, so the list says so.
  const [tracks] = useState(() =>
    referenceDates(toMadridLocal(new Date()).date).map(dayTrack),
  )
  const looks = useMemo(() => {
    const out = new Map<string, LookReason[]>()
    for (const item of needsALook(dataVenues, tracks)) {
      const status = reviews.get(item.venue.id)?.status
      if (status === 'no_terrace' || status === 'not_venue') continue
      out.set(item.venue.id, item.reasons)
    }
    return out
  }, [dataVenues, tracks, reviews])

  useEffect(() => {
    // Edits left from an earlier visit go out first.
    Promise.all([loadTerraces(), flush().then(reload)])
      .then(([file]) => {
        setVenues(file.terraces)
        setMessage('')
      })
      .catch((error: unknown) => setMessage(String(error)))
  }, [flush, reload])

  // Phones: the map keeps its centre above the bottom sheet, and floating
  // buttons sit on top of it (--sheet-h).
  // Measured after every render (before the map flies to a newly selected
  // venue) and whenever the sheet's content resizes it.
  const measureSheet = useCallback(() => {
    const sheet = sheetRef.current
    const root = rootRef.current
    if (!sheet || !root) return
    const height = Math.round(sheet.getBoundingClientRect().height)
    root.style.setProperty('--sheet-h', `${height}px`)
    mapControl.current?.setBottomInset(height)
  }, [])
  useLayoutEffect(measureSheet)
  useEffect(() => {
    const sheet = sheetRef.current
    if (!sheet) return
    const observer = new ResizeObserver(measureSheet)
    observer.observe(sheet)
    return () => observer.disconnect()
  }, [measureSheet])

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

  // Metres from the device to each venue, once located.
  const fix = locate.fix
  const distances = useMemo(
    () =>
      fix &&
      new Map(
        byDistance(mapVenues, fix.at, (v) => v.at).map(({ item, metres }) => [
          item.id,
          metres,
        ]),
      ),
    [mapVenues, fix],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('es')
    return venues.filter(
      (v) =>
        matches(filter, reviews.get(v.id)) &&
        (filter !== 'look' || looks.has(v.id)) &&
        (!q || v.name.toLocaleLowerCase('es').includes(q)),
    )
  }, [venues, reviews, filter, query, looks])

  const byNear = useMemo(
    () =>
      distances &&
      [...filtered].sort(
        (a, b) =>
          (distances.get(a.id) ?? Infinity) - (distances.get(b.id) ?? Infinity),
      ),
    [filtered, distances],
  )
  const listed = nearFirst && byNear ? byNear : filtered
  const nearby = byNear?.slice(0, NEARBY) ?? []

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

  const save = useCallback(
    async (venueId: string, next: Review | null) => {
      setReviews((current) => {
        const copy = new Map(current)
        if (next) copy.set(venueId, next)
        else copy.delete(venueId)
        return copy
      })
      const text = savedMessage(await submit(reviewEdit(venueId, next)))
      if (text) setMessage(text)
    },
    [submit],
  )

  const savePrice = useCallback(
    async (key: string, next: VenuePrice | null) => {
      setPrices((current) => {
        const copy = new Map(current)
        if (next) copy.set(key, next)
        else copy.delete(key)
        return copy
      })
      const text = savedMessage(await submit(priceEdit(key, next)))
      if (text) setMessage(text)
    },
    [submit],
  )

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

  // Where pin mode starts on a phone: the terrace pin, else the venue.
  const pinStart = useRef<LatLon | null>(null)
  useEffect(() => {
    pinStart.current = terrace ?? selectedMap?.at ?? null
  })
  // Phones place the pin under a crosshair: start it on the current pin,
  // once the sheet has its pin-mode height.
  useEffect(() => {
    if (!pinning || !window.matchMedia(PHONE).matches) return
    const start = pinStart.current
    if (start) mapControl.current?.centerOn(start)
  }, [pinning])

  const startPinning = useCallback(() => {
    if (!selectedId) return
    if (pinning) return setPinning(false)
    if (reviews.get(selectedId)?.status !== 'terrace') {
      change({ kind: 'status', status: 'terrace' })
    }
    setPinning(true)
    setSheetOpen(false)
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
      if (menuOpen) {
        if (event.key === 'Escape') setMenuOpen(false)
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
  }, [change, nextToReview, adding, pinning, select, startPinning, menuOpen])

  const startAdding = () => {
    select(null)
    setAdding({ name: '', kind: 'bar', at: null })
  }

  /** Phones: the map position under the crosshair, for the pin or a new venue. */
  const placeAtCrosshair = () => {
    const box = crosshairRef.current?.getBoundingClientRect()
    const control = mapControl.current
    if (!box || !control) return
    const at = control.latLonAt(
      box.left + box.width / 2,
      box.top + box.height / 2,
    )
    if (adding) return setAdding({ ...adding, at })
    change({ kind: 'terrace', at })
    setPinning(false)
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
  const osm = selectedId ? osmUrl(selectedId) : null
  const waiting = edits.queue.length
  const nameOf = (id: string) => venues.find((v) => v.id === id)?.name ?? id
  const placing = pinning || adding !== null
  const away = (id: string) => {
    const metres = distances?.get(id)
    return metres === undefined ? null : formatDistance(metres)
  }

  const sheetHandle = (
    <button
      type="button"
      className="admin-sheet-handle"
      aria-expanded={sheetOpen}
      aria-label={sheetOpen ? 'Show less' : 'Show more'}
      onClick={() => setSheetOpen(!sheetOpen)}
    />
  )

  return (
    <div
      ref={rootRef}
      className={[
        'admin',
        menuOpen && 'admin-menu-open',
        sheetOpen && selectedVenue && 'admin-sheet-open',
        placing && 'admin-placing',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <aside className="admin-side" aria-label="Venues">
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
                aria-pressed={candidatesOpen}
                onClick={() => setCandidatesOpen(!candidatesOpen)}
              >
                Website prices
              </button>
              <button type="button" onClick={startAdding}>
                + Add venue
              </button>
              <button
                type="button"
                className="admin-phone-only admin-menu-close"
                aria-label="Close the list"
                onClick={() => setMenuOpen(false)}
              >
                <CloseIcon />
              </button>
            </span>
          </div>
          <p>
            {reviewed} of {venues.length} reviewed
            {message && <span className="admin-message"> · {message}</span>}
          </p>
          <EditsWaiting
            queue={edits.queue}
            reachable={edits.reachable}
            nameOf={nameOf}
            onRetry={() => void flush()}
            onImport={(text) =>
              edits
                .importFile(text)
                .then((count) => {
                  setMessage(`Imported ${count} edits`)
                  reloadRef.current()
                })
                .catch((error: unknown) =>
                  setMessage(`Not imported: ${String(error)}`),
                )
            }
          />
          <div className="admin-publish" aria-live="polite">
            <button
              type="button"
              disabled={isBusy(publish) || waiting > 0}
              onClick={() => void runPublish()}
            >
              {isBusy(publish) ? 'Publishing…' : 'Publish'}
            </button>
            <p className={`admin-publish-${publish.step}`}>
              {isActive(publish) && <span className="admin-spinner" />}
              {waiting > 0
                ? 'Publish once the waiting edits are saved.'
                : describe(publish)}{' '}
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
              nameOf={nameOf}
              onSelect={select}
              onAccept={acceptSuggestion}
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
          {distances && (
            <div className="admin-filters">
              <button
                type="button"
                aria-pressed={nearFirst}
                onClick={() => setNearFirst(!nearFirst)}
              >
                Nearest first
              </button>
            </div>
          )}
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
                  {distances && (
                    <span className="admin-kind">{away(v.id)}</span>
                  )}
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
          me={locate.fix}
          control={mapControl}
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
        {placing && (
          <div ref={crosshairRef} className="admin-crosshair" aria-hidden />
        )}
        <div className="admin-map-buttons">
          <button
            type="button"
            className="admin-round admin-phone-only"
            aria-label="Venue list and filters"
            onClick={() => setMenuOpen(true)}
          >
            <ListIcon />
          </button>
          <button
            type="button"
            className="admin-round"
            aria-label="Where am I"
            title="Where am I"
            aria-pressed={locate.fix !== null}
            onClick={onLocate}
          >
            <LocateIcon busy={locate.watching && !locate.fix} />
          </button>
        </div>
        {(locate.error || waiting > 0) && (
          <div className="admin-map-notes" aria-live="polite">
            {waiting > 0 && (
              <button
                type="button"
                className="admin-phone-only admin-waiting-pill"
                onClick={() => setMenuOpen(true)}
              >
                {waiting} {waiting === 1 ? 'edit' : 'edits'} waiting
              </button>
            )}
            {locate.error && (
              <p className="admin-toast">Where am I: {locate.error}</p>
            )}
          </div>
        )}
        <div className="admin-sheet" ref={sheetRef}>
          {adding && (
            <section className="admin-panel" aria-label="Add a venue">
              <h2>Add a venue</h2>
              <p className="admin-help">
                For a bar or restaurant that is missing from the list.{' '}
                <span className="admin-desktop-only">
                  Click the map where it is, then name it.
                </span>
                <span className="admin-phone-only">
                  Move the map so the cross is on it and tap Place here, then
                  name it.
                </span>
              </p>
              <div className="admin-actions admin-phone-only">
                <button type="button" onClick={placeAtCrosshair}>
                  Place here
                </button>
              </div>
              <label className="admin-field">
                Name
                <input
                  autoFocus={!window.matchMedia(PHONE).matches}
                  value={adding.name}
                  onChange={(e) =>
                    setAdding({ ...adding, name: e.target.value })
                  }
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
                {adding.at ? (
                  <>
                    Placed.{' '}
                    <span className="admin-desktop-only">
                      Drag the pin or click again to adjust.
                    </span>
                    <span className="admin-phone-only">
                      Drag the pin or place it again to adjust.
                    </span>
                  </>
                ) : (
                  <>
                    Not placed yet
                    <span className="admin-desktop-only">: click the map</span>.
                  </>
                )}
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
              {sheetHandle}
              <div className="admin-panel-head">
                <h2>{selectedVenue.name}</h2>
                <button
                  type="button"
                  className="admin-phone-only admin-close"
                  aria-label="Close the venue"
                  onClick={() => select(null)}
                >
                  <CloseIcon />
                </button>
              </div>
              <p className="admin-meta">
                {selectedVenue.kind} · {selectedVenue.sources.join(', ')} ·{' '}
                {STATE_LABELS[selectedMap.state]}
                {review?.venue &&
                  !selectedVenue.id.startsWith(ADDED_PREFIX) &&
                  ' · moved'}
                {away(selectedVenue.id) && ` · ${away(selectedVenue.id)}`}
              </p>
              <p className="admin-meta admin-more">
                {osm ? (
                  <a href={osm} target="_blank" rel="noreferrer">
                    {selectedVenue.id}
                  </a>
                ) : (
                  selectedVenue.id
                )}
              </p>
              <div className="admin-actions admin-status">
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
                <div className="admin-pin-mode">
                  <p className="admin-desktop-only">
                    Click the map where the tables are. Esc cancels.
                  </p>
                  <p className="admin-phone-only">
                    Move the map so the cross is on the tables, or drag the pin.
                  </p>
                  <div className="admin-actions admin-phone-only">
                    <button type="button" onClick={placeAtCrosshair}>
                      Place terrace here
                    </button>
                    <button type="button" onClick={() => setPinning(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="admin-help admin-more">
                  <span className="admin-desktop-only">
                    T marks a terrace and lets you place its pin with one click;
                    press T again to move it. Drag the dark pin to fix the venue
                    position.
                  </span>
                  <span className="admin-phone-only">
                    Terrace marks it and places its pin; tap it again to move
                    the pin. Drag the dark pin to fix the venue position.
                  </span>
                </p>
              )}
              <div className="admin-more">
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
              </div>
              {!sheetOpen && !pinning && (
                <button
                  type="button"
                  className="admin-phone-only admin-sheet-more"
                  onClick={() => setSheetOpen(true)}
                >
                  Prices, sun and more
                </button>
              )}
            </section>
          )}
          {!adding && !selectedVenue && (
            <section
              className="admin-nearby admin-phone-only"
              aria-label="Nearest venues"
            >
              {nearby.length > 0 ? (
                <ol className="admin-chips">
                  {nearby.map((v) => {
                    const state = stateOf(v, reviews.get(v.id))
                    return (
                      <li key={v.id}>
                        <button type="button" onClick={() => select(v.id)}>
                          <span
                            className="admin-dot"
                            style={{ background: STATE_COLORS[state] }}
                          />
                          <span className="admin-chip-name">{v.name}</span>
                          <span className="admin-kind">{away(v.id)}</span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <p className="admin-help">
                  {reviewed} of {venues.length} reviewed
                  {message && ` · ${message}`}. Tap a dot, or find the venues
                  around you with the locate button.
                </p>
              )}
            </section>
          )}
        </div>
      </main>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LocateIcon({ busy }: { busy: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden="true"
      className={busy ? 'admin-locating' : undefined}
    >
      <circle
        cx="12"
        cy="12"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path
        d="M12 1v4M12 19v4M1 12h4M19 12h4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}

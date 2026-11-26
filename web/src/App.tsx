import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  loadTerraces,
  type LatLon,
  type Terrace,
  type TerracesFile,
} from './data/terraces.ts'
import {
  applyFilters,
  DEFAULT_FILTERS,
  matchesQuery,
  type Filters,
} from './filters/filters.ts'
import { MapView } from './map/LazyMapView.tsx'
import { AdminButton } from './prices/AdminButton.tsx'
import { useCanSend } from './prices/owner.ts'
import { DraftContext, type ChangeDraft } from './reports/draft.ts'
import {
  StartMoveContext,
  type Picking,
  type PlaceTarget,
} from './reports/picking.ts'
import { ReportPicker } from './reports/ReportPicker.tsx'
import * as telemetry from './telemetry.ts'
import { mixHex, nightDepth } from './map/night.ts'
import { dayTrack, stepIndex, sunTimes } from './sun/dayTrack.ts'
import { isLeafOff } from './sun/leafOff.ts'
import { correctionsByVenue, useSunCorrections } from './sun/corrections.ts'
import {
  compareStatus,
  correctDays,
  venueDay,
  venueStatus,
} from './sun/venueStatus.ts'
import { toMadridLocal } from './time/madrid.ts'
import { FiltersPanel } from './ui/FiltersPanel.tsx'
import { CloseIcon, Logo, MenuIcon } from './ui/icons.tsx'
import { SearchBox } from './ui/SearchBox.tsx'
import { TimeSlider } from './ui/TimeSlider.tsx'
import { useMediaQuery } from './ui/useMediaQuery.ts'
import { VenueList } from './ui/VenueList.tsx'
import { startState, wasReloaded, writeUrlState } from './urlState.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: TerracesFile }

/** While the report picker is open, tapping badges doesn't open cards. */
function ignoreSelect() {}

/** How long the time and venue rest before they're written to the URL. */
const URL_WRITE_DELAY_MS = 400

/** The app always shows today in Madrid. */
const madridNow = () => toMadridLocal(new Date())

/** The hour a minute of the day falls in, as the usage counters take it: "00" … "23". */
const hourOf = (minutes: number) =>
  String(Math.floor(minutes / 60) % 24).padStart(2, '0')

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [now, setNow] = useState(madridNow)
  // Time and venue start from the URL (a shared link), else the current
  // time with nothing selected. A null time follows the clock.
  // A reload goes back to the current time; a link keeps its own.
  const [linked] = useState(() =>
    startState(window.location.search, wasReloaded()),
  )
  const [time, setTime] = useState(linked.time)
  const minutes = time ?? now.minutes
  const date = now.date
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useState(linked.venue)
  // Phones: the time bar is the footer; search, filters and the list live in
  // a menu that opens over the map.
  const phone = useMediaQuery('(max-width: 899px)')
  const canSend = useCanSend()
  const [menuOpen, setMenuOpen] = useState(false)
  // Reporting a moved or missing venue: a centre pin over the map.
  const [picking, setPicking] = useState<Picking | null>(null)
  const [center, setCenter] = useState<LatLon | null>(null)
  // The open card back's draft, kept while its venue is moved on the map.
  const [draft, setDraft] = useState<ChangeDraft | null>(null)
  const draftState = useMemo(() => ({ draft, setDraft }), [draft])

  useEffect(() => {
    let cancelled = false
    loadTerraces().then(
      ({ file }) => {
        if (cancelled) return
        setLoad({ status: 'ready', file })
        // A linked venue that doesn't exist is dropped; one without a
        // terrace needs the terrace filter off to show.
        if (linked.venue === null) return
        const venue = file.terraces.find((v) => v.id === linked.venue)
        if (!venue) setSelectedId((id) => (id === linked.venue ? null : id))
        else if (venue.terrace === null)
          setFilters((f) => ({ ...f, onlyTerrace: false }))
      },
      () => {
        if (!cancelled) setLoad({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [linked])

  // Mirror the time and the venue into the URL, so the address is a link to
  // this view. Once the slider rests: Safari throws on more than 100
  // replaceState calls in 10 s, and a throw here would blank the whole app.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const { pathname, search, hash } = window.location
      const next = writeUrlState(search, { time, venue: selectedId })
      if (next === search) return
      try {
        window.history.replaceState(
          window.history.state,
          '',
          pathname + next + hash,
        )
      } catch {
        // Over the browser's limit: the next change writes it.
      }
    }, URL_WRITE_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [time, selectedId])

  // A card opened, from the map, the list or a link.
  useEffect(() => {
    if (selectedId !== null) telemetry.track('venue_open', selectedId)
  }, [selectedId])

  // Keep "now" current: the marker on the bar, the time while it follows the
  // clock, and the date after midnight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(madridNow()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const track = useMemo(() => dayTrack(date), [date])
  // Sun/shade per venue for the whole day, with the records' own accepted
  // sun corrections: recomputed only when the day changes.
  const modelDays = useMemo(
    () =>
      load.status === 'ready'
        ? load.file.terraces.map((venue) => venueDay(venue, track))
        : [],
    [load, track],
  )
  // Visitors' sun reports: only the venues they correct are computed again.
  const corrections = useSunCorrections()
  const days = useMemo(
    () => correctDays(modelDays, correctionsByVenue(corrections), track),
    [modelDays, corrections, track],
  )
  const leafOffTrees = useMemo(
    () =>
      load.status === 'ready' &&
      load.file.terraces.some((venue) => venue.horizon_winter),
    [load],
  )
  const statuses = useMemo(
    () => days.map((day) => venueStatus(day, minutes)).sort(compareStatus),
    [days, minutes],
  )
  const visible = useMemo(
    () => applyFilters(statuses, filters, query),
    [statuses, filters, query],
  )
  const sun = track.positions[stepIndex(minutes)] ?? {
    altitude: -1,
    azimuth: 0,
  }

  const depth = nightDepth(sun.altitude)
  const night = depth !== null

  // The browser chrome (address bar on phones) follows the theme too.
  useEffect(() => {
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        depth === null ? '#FFC53D' : mixHex('#2D3348', '#141826', depth),
      )
    // Dusk is softer than deep night (see .app.is-night in styles/night.css).
    document.documentElement.style.setProperty(
      '--night-depth',
      String(depth ?? 1),
    )
  }, [depth])

  const times = useMemo(() => sunTimes(track), [track])

  const chooseTime = useCallback((chosen: number) => {
    setTime(chosen)
    telemetry.trackSettled('time_change', hourOf(chosen))
  }, [])

  const goToNow = useCallback(() => {
    setNow(madridNow())
    setTime(null)
  }, [])

  // Picking a venue from the list closes the menu so its map card shows.
  const selectFromList = useCallback((id: string | null) => {
    setSelectedId(id)
    setMenuOpen(false)
    setPicking(null)
    setCenter(null)
  }, [])

  // A move starts where the visitor last placed it, else at the badge; the
  // tables likewise, else at the terrace (or the venue, with none yet).
  const startMove = useCallback(
    (venue: Terrace, target: PlaceTarget = 'move') => {
      const mine = draft?.venueId === venue.id ? draft : null
      const placed =
        target === 'pin' ? (mine?.pin ?? null) : (mine?.move ?? null)
      setSelectedId(null)
      setPicking({
        kind: target,
        venue,
        from: placed ?? venue.terrace ?? venue.venue,
      })
    },
    [draft],
  )
  const startAdd = useCallback((name?: string) => {
    telemetry.track('add_open')
    setMenuOpen(false)
    setSelectedId(null)
    setPicking(name ? { kind: 'add', name } : { kind: 'add' })
  }, [])
  const stopPicking = useCallback(() => {
    // A move or the tables return to the card's back; adding a venue just ends.
    if (picking && picking.kind !== 'add') setSelectedId(picking.venue.id)
    setPicking(null)
    setCenter(null)
  }, [picking])
  // The spot placed goes back to the card's draft, as the move or the tables.
  const placeMove = useCallback(
    (spot: LatLon) => {
      if (!picking || picking.kind === 'add') return
      const id = picking.venue.id
      const patch = picking.kind === 'pin' ? { pin: spot } : { move: spot }
      setDraft((d) => (d?.venueId === id ? { ...d, ...patch } : d))
      stopPicking()
    },
    [picking, stopPicking],
  )
  const flyTo = useMemo(
    () => (picking && picking.kind !== 'add' ? picking.from : null),
    [picking],
  )

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  const timeSlider = (
    <TimeSlider
      minutes={minutes}
      onChange={chooseTime}
      onNow={goToNow}
      now={now.minutes}
      sunrise={times?.sunrise ?? null}
      sunset={times?.sunset ?? null}
    />
  )

  return (
    <div
      className={`app${night ? ' is-night' : ''}${picking ? ' is-picking' : ''}`}
    >
      <header className="brand">
        <Logo />
        <h1>Sol y Cerveza</h1>
        <AdminButton />
        {phone && (
          <button
            type="button"
            className="menu-button"
            aria-label={menuOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={menuOpen}
            aria-controls="sidebar"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            {menuOpen ? <CloseIcon size={24} /> : <MenuIcon size={24} />}
          </button>
        )}
      </header>
      <aside id="sidebar" className="sidebar" hidden={phone && !menuOpen}>
        <SearchBox value={query} onChange={setQuery} />
        {!phone && timeSlider}
        <FiltersPanel filters={filters} onChange={setFilters} />
        {load.status === 'ready' && load.file.sample && (
          <p className="sample-notice" role="note">
            Datos de ejemplo: estas terrazas y sus sombras son ficticias.
          </p>
        )}
        {load.status === 'loading' && (
          <p className="status-line">Cargando bares…</p>
        )}
        {load.status === 'error' && (
          <p className="status-line" role="alert">
            No se han podido cargar las terrazas.
          </p>
        )}
        {load.status === 'ready' && (
          <VenueList
            statuses={visible}
            total={statuses.length}
            minutes={minutes}
            selectedId={selectedId}
            onSelect={selectFromList}
            onAdd={canSend ? startAdd : undefined}
            query={query}
            nameUnknown={
              query.trim() !== '' &&
              !statuses.some((s) => matchesQuery(s.venue.name, query))
            }
          />
        )}
      </aside>
      <main className="map-area">
        <StartMoveContext value={startMove}>
          <DraftContext value={draftState}>
            <MapView
              statuses={visible}
              selectedId={selectedId}
              onSelect={picking ? ignoreSelect : setSelectedId}
              sun={sun}
              minutes={minutes}
              sunset={times?.sunset ?? null}
              attribution={load.status === 'ready' ? load.file.attribution : []}
              leafOffTrees={leafOffTrees}
              leafOff={leafOffTrees && isLeafOff(date)}
              onCenterChange={picking ? setCenter : undefined}
              flyTo={flyTo}
            />
          </DraftContext>
        </StartMoveContext>
        {picking && (
          <ReportPicker
            key={
              picking.kind === 'add'
                ? 'add'
                : `${picking.kind}:${picking.venue.id}`
            }
            picking={picking}
            center={center}
            onPlace={placeMove}
            onClose={stopPicking}
          />
        )}
      </main>
      {phone && !picking && (
        <footer className="time-footer">{timeSlider}</footer>
      )}
    </div>
  )
}

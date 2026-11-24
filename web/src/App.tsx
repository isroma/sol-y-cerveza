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
  type Filters,
} from './filters/filters.ts'
import { MapView } from './map/LazyMapView.tsx'
import { OwnerBar } from './prices/OwnerBar.tsx'
import { StartMoveContext, type Picking } from './reports/picking.ts'
import { ReportPicker } from './reports/ReportPicker.tsx'
import { CAN_REPORT } from './reports/reports.ts'
import { mixHex, nightDepth } from './map/night.ts'
import { dayTrack, stepIndex, sunTimes } from './sun/dayTrack.ts'
import { compareStatus, venueDay, venueStatus } from './sun/venueStatus.ts'
import { toMadridLocal } from './time/madrid.ts'
import { FiltersPanel } from './ui/FiltersPanel.tsx'
import { CloseIcon, Logo, MenuIcon } from './ui/icons.tsx'
import { SearchBox } from './ui/SearchBox.tsx'
import { TimeSlider } from './ui/TimeSlider.tsx'
import { useMediaQuery } from './ui/useMediaQuery.ts'
import { VenueList } from './ui/VenueList.tsx'
import { readUrlState, writeUrlState } from './urlState.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: TerracesFile }

/** While the report picker is open, tapping badges doesn't open cards. */
function ignoreSelect() {}

/** The app always shows today in Madrid. */
const madridNow = () => toMadridLocal(new Date())

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [now, setNow] = useState(madridNow)
  // Time and venue start from the URL (a shared link), else the current
  // time with nothing selected. A null time follows the clock.
  const [linked] = useState(() => readUrlState(window.location.search))
  const [time, setTime] = useState(linked.time)
  const minutes = time ?? now.minutes
  const date = now.date
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useState(linked.venue)
  // Phones: the time bar is the footer; search, filters and the list live in
  // a menu that opens over the map.
  const phone = useMediaQuery('(max-width: 899px)')
  const [menuOpen, setMenuOpen] = useState(false)
  // Reporting a moved or missing venue: a centre pin over the map.
  const [picking, setPicking] = useState<Picking | null>(null)
  const [center, setCenter] = useState<LatLon | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTerraces().then(
      (file) => {
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
  // this view.
  useEffect(() => {
    const { pathname, search, hash } = window.location
    const next = writeUrlState(search, { time, venue: selectedId })
    if (next !== search)
      window.history.replaceState(
        window.history.state,
        '',
        pathname + next + hash,
      )
  }, [time, selectedId])

  // Keep "now" current: the marker on the bar, the time while it follows the
  // clock, and the date after midnight.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(madridNow()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const track = useMemo(() => dayTrack(date), [date])
  // Sun/shade per venue for the whole day: recomputed only when the day changes.
  const days = useMemo(
    () =>
      load.status === 'ready'
        ? load.file.terraces.map((venue) => venueDay(venue, track))
        : [],
    [load, track],
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
    // Dusk is softer than deep night (see .app.is-night in index.css).
    document.documentElement.style.setProperty(
      '--night-depth',
      String(depth ?? 1),
    )
  }, [depth])

  const times = useMemo(() => sunTimes(track), [track])

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

  const startMove = useCallback((venue: Terrace) => {
    setSelectedId(null)
    setPicking({ kind: 'move', venue })
  }, [])
  const startAdd = useCallback(() => {
    setMenuOpen(false)
    setSelectedId(null)
    setPicking({ kind: 'add' })
  }, [])
  const stopPicking = useCallback(() => {
    setPicking(null)
    setCenter(null)
  }, [])
  const flyTo = useMemo(
    () =>
      picking?.kind === 'move'
        ? (picking.venue.terrace ?? picking.venue.venue)
        : null,
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
      onChange={setTime}
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
            onAdd={CAN_REPORT ? startAdd : undefined}
          />
        )}
      </aside>
      <main className="map-area">
        <StartMoveContext value={startMove}>
          <MapView
            statuses={visible}
            selectedId={selectedId}
            onSelect={picking ? ignoreSelect : setSelectedId}
            sun={sun}
            minutes={minutes}
            sunset={times?.sunset ?? null}
            attribution={load.status === 'ready' ? load.file.attribution : []}
            leafOffTrees={leafOffTrees}
            onCenterChange={picking ? setCenter : undefined}
            flyTo={flyTo}
          />
        </StartMoveContext>
        {picking && (
          <ReportPicker
            key={picking.kind === 'move' ? picking.venue.id : 'add'}
            picking={picking}
            center={center}
            onClose={stopPicking}
          />
        )}
        {load.status === 'ready' && (
          <OwnerBar venues={load.file.terraces} onSelect={setSelectedId} />
        )}
      </main>
      {phone && !picking && (
        <footer className="time-footer">{timeSlider}</footer>
      )}
    </div>
  )
}

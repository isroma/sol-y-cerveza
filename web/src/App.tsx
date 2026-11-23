import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type TerracesFile } from './data/terraces.ts'
import {
  applyFilters,
  DEFAULT_FILTERS,
  type Filters,
} from './filters/filters.ts'
import { MapView } from './map/MapView.tsx'
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

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: TerracesFile }

/** The app always shows today in Madrid, starting at the current time. */
const madridNow = () => toMadridLocal(new Date())

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [now, setNow] = useState(madridNow)
  const [minutes, setMinutes] = useState(now.minutes)
  const date = now.date
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Phones: the time bar is the footer; search, filters and the list live in
  // a menu that opens over the map.
  const phone = useMediaQuery('(max-width: 899px)')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadTerraces().then(
      (file) => {
        if (!cancelled) setLoad({ status: 'ready', file })
      },
      () => {
        if (!cancelled) setLoad({ status: 'error' })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // Keep "now" current (the marker on the bar, and the date after midnight).
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
    const current = madridNow()
    setNow(current)
    setMinutes(current.minutes)
  }, [])

  // Picking a venue from the list closes the menu so its map card shows.
  const selectFromList = useCallback((id: string | null) => {
    setSelectedId(id)
    setMenuOpen(false)
  }, [])

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
      onChange={setMinutes}
      onNow={goToNow}
      now={now.minutes}
      sunrise={times?.sunrise ?? null}
      sunset={times?.sunset ?? null}
    />
  )

  return (
    <div className={night ? 'app is-night' : 'app'}>
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
          />
        )}
      </aside>
      <main className="map-area">
        <MapView
          statuses={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          sun={sun}
          minutes={minutes}
          sunset={times?.sunset ?? null}
          attribution={load.status === 'ready' ? load.file.attribution : []}
        />
      </main>
      {phone && <footer className="time-footer">{timeSlider}</footer>}
    </div>
  )
}

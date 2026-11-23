import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadTerraces, type TerracesFile } from './data/terraces.ts'
import {
  applyFilters,
  DEFAULT_FILTERS,
  type Filters,
} from './filters/filters.ts'
import { MapView } from './map/MapView.tsx'
import { mixHex, nightDepth } from './map/night.ts'
import { dayTrack, stepIndex } from './sun/dayTrack.ts'
import { compareStatus, venueDay, venueStatus } from './sun/venueStatus.ts'
import { formatClock, toMadridLocal } from './time/madrid.ts'
import { DaySelector } from './ui/DaySelector.tsx'
import { FiltersPanel } from './ui/FiltersPanel.tsx'
import { Logo } from './ui/icons.tsx'
import { SearchBox } from './ui/SearchBox.tsx'
import { SLIDER_END, SLIDER_START, TimeSlider } from './ui/TimeSlider.tsx'
import { VenueCard } from './ui/VenueCard.tsx'
import { VenueList } from './ui/VenueList.tsx'
import { readUrlState, writeUrlState } from './urlState.ts'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: TerracesFile }

/** Now in Madrid nudged into the slider's terrace hours, unless the URL says otherwise. */
function initialTime() {
  const now = toMadridLocal(new Date())
  const url = readUrlState(window.location.search)
  return {
    today: now.date,
    date: url.date ?? now.date,
    minutes:
      url.minutes ?? Math.min(SLIDER_END, Math.max(SLIDER_START, now.minutes)),
  }
}

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [{ today, date: startDate, minutes: startMinutes }] =
    useState(initialTime)
  const [date, setDate] = useState(startDate)
  const [minutes, setMinutes] = useState(startMinutes)
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [selectedId, setSelectedId] = useState<string | null>(null)

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

  useEffect(() => {
    window.history.replaceState(
      null,
      '',
      writeUrlState(date, formatClock(minutes)),
    )
  }, [date, minutes])

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
  const selected = statuses.find((s) => s.venue.id === selectedId) ?? null
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

  const goToNow = useCallback(() => {
    const now = toMadridLocal(new Date())
    setDate(now.date)
    setMinutes(now.minutes)
  }, [])

  return (
    <div className={night ? 'app is-night' : 'app'}>
      <aside className="sidebar">
        <header className="brand">
          <Logo />
          <h1>Sol y Cerveza</h1>
        </header>
        <SearchBox value={query} onChange={setQuery} />
        <DaySelector date={date} today={today} onChange={setDate} />
        <TimeSlider minutes={minutes} onChange={setMinutes} onNow={goToNow} />
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
            onSelect={setSelectedId}
          />
        )}
        {selected && (
          <VenueCard
            key={selected.venue.id}
            status={selected}
            minutes={minutes}
            onClose={() => setSelectedId(null)}
          />
        )}
      </aside>
      <main className="map-area">
        <MapView
          statuses={visible}
          selectedId={selectedId}
          onSelect={setSelectedId}
          sun={sun}
          attribution={load.status === 'ready' ? load.file.attribution : []}
        />
      </main>
    </div>
  )
}

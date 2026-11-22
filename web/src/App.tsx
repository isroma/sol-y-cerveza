import { useEffect, useMemo, useState } from 'react'
import { loadTerraces, type TerracesFile } from './data/terraces.ts'
import { TerraceMap, type MapTerrace } from './map/TerraceMap.tsx'
import { terraceStatuses } from './sun/terraceStatus.ts'
import {
  fromMadridLocal,
  MINUTES_PER_DAY,
  toMadridLocal,
} from './time/madrid.ts'
import { TerraceList } from './ui/TerraceList.tsx'
import { TimeControls } from './ui/TimeControls.tsx'

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; file: TerracesFile }

export function App() {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' })
  const [local, setLocal] = useState(() => toMadridLocal(new Date()))

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

  const statuses = useMemo(() => {
    if (load.status !== 'ready') return []
    return terraceStatuses(
      load.file.terraces,
      fromMadridLocal(local.date, local.minutes),
      fromMadridLocal(local.date, MINUTES_PER_DAY),
    )
  }, [load, local])

  const mapTerraces = useMemo(
    (): MapTerrace[] =>
      statuses.map(({ terrace, state }) => ({
        id: terrace.id,
        name: terrace.name,
        lat: terrace.terrace.lat,
        lon: terrace.terrace.lon,
        state,
        verified: terrace.verified,
      })),
    [statuses],
  )

  return (
    <div className="app">
      <header className="app-header">
        <h1>Sol y Cerveza</h1>
        <p>Terrazas de Badajoz al sol o a la sombra</p>
      </header>
      {load.status === 'ready' && load.file.sample && (
        <p className="sample-notice" role="note">
          Datos de ejemplo: estas terrazas y sus sombras son ficticias.
        </p>
      )}
      <main className="app-main">
        <TimeControls value={local} onChange={setLocal} />
        <div className="map-pane">
          <TerraceMap terraces={mapTerraces} />
        </div>
        <div className="results">
          {load.status === 'loading' && <p>Cargando terrazas…</p>}
          {load.status === 'error' && (
            <p role="alert">No se han podido cargar las terrazas.</p>
          )}
          {load.status === 'ready' && (
            <>
              <TerraceList statuses={statuses} />
              <footer className="attribution">
                {load.file.attribution.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </footer>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

import { lazy, Suspense, type ComponentProps } from 'react'
import { importOrReload } from './chunkReload.ts'
import type { MapView as MapViewComponent } from './MapView.tsx'

type MapProps = ComponentProps<typeof MapViewComponent>

/** When the map code can't be loaded even after a reload. */
function MapUnavailable(_props: MapProps) {
  return (
    <div className="map-loading" role="alert">
      <p>
        No se pudo cargar el mapa. Comprueba la conexión y recarga la página.
      </p>
    </div>
  )
}

// MapLibre is most of the app's JavaScript. Loading the map as its own chunk
// lets the sidebar, list and time bar paint first while the map downloads.
// After a deploy, an open page may ask for a chunk the server no longer has:
// reload once to get the new version (chunkReload.ts).
const LazyMap = lazy(() =>
  importOrReload(() => import('./MapView.tsx')).then(
    ({ MapView }) => ({ default: MapView }),
    () => ({ default: MapUnavailable }),
  ),
)

/** The map, loaded on demand, with a calm placeholder until it is ready. */
export function MapView(props: MapProps) {
  return (
    <Suspense
      fallback={
        <div className="map-loading">
          <p>Cargando mapa…</p>
        </div>
      }
    >
      <LazyMap {...props} />
    </Suspense>
  )
}

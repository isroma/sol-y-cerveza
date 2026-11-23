import { lazy, Suspense, type ComponentProps } from 'react'

// MapLibre is most of the app's JavaScript. Loading the map as its own chunk
// lets the sidebar, list and time bar paint first while the map downloads.
const LazyMap = lazy(() =>
  import('./MapView.tsx').then(({ MapView }) => ({ default: MapView })),
)

/** The map, loaded on demand, with a calm placeholder until it is ready. */
export function MapView(props: ComponentProps<typeof LazyMap>) {
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

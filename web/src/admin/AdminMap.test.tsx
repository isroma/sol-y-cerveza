import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminMap } from './AdminMap.tsx'
import { ORTHO_CREDIT, ORTHO_LAYER, ORTHO_SOURCE } from './ortho.ts'

// MapLibre needs WebGL, which jsdom does not provide: a fake map records what
// the admin asks of it.
const { maps, FakeMap } = vi.hoisted(() => {
  type Call = [string, ...unknown[]]

  class FakeMap {
    calls: Call[] = []
    handlers = new Map<string, () => void>()
    touchZoomRotate = { disableRotation: () => undefined }
    keyboard = { disableRotation: () => undefined }
    constructor() {
      maps.push(this)
    }
    on(event: string, ...rest: unknown[]) {
      const handler = rest.at(-1)
      if (typeof handler === 'function' && rest.length === 1)
        this.handlers.set(event, () => handler())
      return this
    }
    addSource(...args: unknown[]) {
      this.calls.push(['addSource', ...args])
    }
    addLayer(...args: unknown[]) {
      this.calls.push(['addLayer', ...args])
    }
    setLayoutProperty(...args: unknown[]) {
      this.calls.push(['setLayoutProperty', ...args])
    }
    setPaintProperty(...args: unknown[]) {
      this.calls.push(['setPaintProperty', ...args])
    }
    getSource() {
      return { setData: () => undefined }
    }
    getCanvas() {
      return { style: {} }
    }
    getZoom() {
      return 15
    }
    easeTo() {}
    remove() {}
  }

  const maps: FakeMap[] = []
  return { maps, FakeMap }
})

type FakeMap = InstanceType<typeof FakeMap>

vi.mock('maplibre-gl', () => ({
  Map: FakeMap,
  Marker: class {
    setLngLat() {
      return this
    }
    addTo() {
      return this
    }
    on() {
      return this
    }
    remove() {}
  },
  setWorkerUrl: () => undefined,
}))
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({
  default: '',
}))

const baseStyle = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://example/tiles' } },
  layers: [
    { id: 'background', type: 'background' },
    {
      id: 'road',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
    },
    {
      id: 'road_label',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
    },
  ],
}

const noop = () => undefined

function renderMap() {
  render(
    <AdminMap
      venues={[]}
      selected={null}
      terrace={null}
      pinning={false}
      onSelect={noop}
      onMapClick={noop}
      onPinTerrace={noop}
      onDragTerrace={noop}
      onMoveVenue={noop}
    />,
  )
}

async function loadedMap(): Promise<FakeMap> {
  await waitFor(() => expect(maps).toHaveLength(1))
  const [map] = maps
  if (!map) throw new Error('no map')
  map.handlers.get('load')?.()
  return map
}

beforeEach(() => {
  maps.length = 0
  localStorage.clear()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(baseStyle))),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('AdminMap orthophoto', () => {
  it('adds the photo hidden, under the first label', async () => {
    renderMap()
    const map = await loadedMap()
    expect(map.calls).toContainEqual([
      'addSource',
      ORTHO_SOURCE,
      expect.objectContaining({ type: 'raster' }),
    ])
    expect(map.calls).toContainEqual([
      'addLayer',
      expect.objectContaining({
        id: ORTHO_LAYER,
        layout: { visibility: 'none' },
      }),
      'road_label',
    ])
    expect(screen.queryByText(ORTHO_CREDIT)).toBeNull()
  })

  it('shows the photo, white dot rings and the credit while on', async () => {
    renderMap()
    const map = await loadedMap()
    const button = screen.getByRole('button', { name: 'Orthophoto' })
    expect(button.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(button)
    await waitFor(() =>
      expect(map.calls).toContainEqual([
        'setLayoutProperty',
        ORTHO_LAYER,
        'visibility',
        'visible',
      ]),
    )
    expect(map.calls).toContainEqual([
      'setPaintProperty',
      'venues-dots',
      'circle-stroke-color',
      '#FFFFFF',
    ])
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText(ORTHO_CREDIT)).toBeTruthy()
    expect(localStorage.getItem('admin-ortho')).toBe('1')

    fireEvent.click(button)
    await waitFor(() =>
      expect(map.calls.at(-3)).toEqual([
        'setLayoutProperty',
        ORTHO_LAYER,
        'visibility',
        'none',
      ]),
    )
    expect(screen.queryByText(ORTHO_CREDIT)).toBeNull()
  })

  it('opens on the photo when it was on last time', async () => {
    localStorage.setItem('admin-ortho', '1')
    renderMap()
    const map = await loadedMap()
    expect(map.calls).toContainEqual([
      'addLayer',
      expect.objectContaining({
        id: ORTHO_LAYER,
        layout: { visibility: 'visible' },
      }),
      'road_label',
    ])
    expect(screen.getByText(ORTHO_CREDIT)).toBeTruthy()
  })
})

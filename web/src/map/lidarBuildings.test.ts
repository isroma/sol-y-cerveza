import { describe, expect, it, vi } from 'vitest'
import { addExtrusionSource } from './extrusionSource.ts'
import {
  addLidarBuildings,
  BUILDINGS_URL,
  LIDAR_BUILDING_LAYERS,
  LIDAR_BUILDINGS,
} from './lidarBuildings.ts'
import { ROOF_M } from './mapStyle.ts'

vi.mock('./extrusionSource.ts', () => ({ addExtrusionSource: vi.fn() }))

describe('addLidarBuildings', () => {
  it('draws walls and roofs before the given layer and hides the basemap buildings', () => {
    const map = {
      addSource: vi.fn(),
      getSource: vi.fn(),
      addLayer: vi.fn(),
      getLayer: vi.fn(),
      setLayoutProperty: vi.fn(),
    }
    map.getLayer.mockImplementation((id: string) =>
      id === 'building-3d' ? {} : undefined,
    )
    addLidarBuildings(map, 'building-3d')
    expect(addExtrusionSource).toHaveBeenCalledWith(
      map,
      LIDAR_BUILDINGS,
      BUILDINGS_URL,
    )
    expect(map.addLayer.mock.calls).toEqual(
      LIDAR_BUILDING_LAYERS.map((layer) => [layer, 'building-3d']),
    )
    // Only the layers the style has (building-roof is missing here).
    expect(map.setLayoutProperty.mock.calls).toEqual([
      ['building-3d', 'visibility', 'none'],
    ])
  })

  it('uses the real heights, with a roof cap on top', () => {
    const [walls, roofs] = LIDAR_BUILDING_LAYERS
    expect(walls?.paint?.['fill-extrusion-height']).toEqual(['get', 'h'])
    expect(roofs?.paint?.['fill-extrusion-base']).toEqual(['get', 'h'])
    expect(roofs?.paint?.['fill-extrusion-height']).toEqual([
      '+',
      ['get', 'h'],
      ROOF_M,
    ])
  })
})

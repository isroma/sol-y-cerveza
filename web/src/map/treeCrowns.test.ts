import { describe, expect, it, vi } from 'vitest'
import { addExtrusionSource } from './extrusionSource.ts'
import { TREES } from './layerIds.ts'
import {
  addTreeCrowns,
  BARE_TREE_COLOR,
  LEAF_OFF_STATE,
  setLeafOff,
  TREE_COLOR,
  TREE_LAYER,
  TREES_URL,
} from './treeCrowns.ts'

vi.mock('./extrusionSource.ts', () => ({ addExtrusionSource: vi.fn() }))

describe('addTreeCrowns', () => {
  it('adds the crowns from the data file, before the given layer', () => {
    const map = { addSource: vi.fn(), getSource: vi.fn(), addLayer: vi.fn() }
    addTreeCrowns(map, 'lidar-buildings')
    expect(addExtrusionSource).toHaveBeenCalledWith(map, TREES, TREES_URL)
    expect(map.addLayer).toHaveBeenCalledWith(TREE_LAYER, 'lidar-buildings')
  })

  it('extrudes each band from its base to its top', () => {
    expect(TREE_LAYER.paint?.['fill-extrusion-base']).toEqual(['get', 'b'])
    expect(TREE_LAYER.paint?.['fill-extrusion-height']).toEqual(['get', 'h'])
  })

  it('draws deciduous crowns bare only while the leaf-off state is on', () => {
    expect(TREE_LAYER.paint?.['fill-extrusion-color']).toEqual([
      'case',
      [
        'all',
        ['==', ['global-state', LEAF_OFF_STATE], true],
        ['==', ['get', 'd'], 1],
      ],
      BARE_TREE_COLOR,
      TREE_COLOR,
    ])
    const map = { setGlobalStateProperty: vi.fn() }
    setLeafOff(map, true)
    expect(map.setGlobalStateProperty).toHaveBeenCalledWith(
      LEAF_OFF_STATE,
      true,
    )
  })
})

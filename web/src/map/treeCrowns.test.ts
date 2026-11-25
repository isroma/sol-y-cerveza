import { describe, expect, it, vi } from 'vitest'
import { addExtrusionSource } from './extrusionSource.ts'
import { addTreeCrowns, TREE_LAYER, TREES, TREES_URL } from './treeCrowns.ts'

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
})

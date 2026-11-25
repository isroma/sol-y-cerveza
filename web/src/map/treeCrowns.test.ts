import { describe, expect, it, vi } from 'vitest'
import { addTreeCrowns, TREE_LAYER, TREES, TREES_URL } from './treeCrowns.ts'

describe('addTreeCrowns', () => {
  it('adds the crowns from the data file, before the given layer', () => {
    const addSource = vi.fn()
    const addLayer = vi.fn()
    addTreeCrowns({ addSource, addLayer }, 'building-3d')
    expect(addSource).toHaveBeenCalledWith(TREES, {
      type: 'geojson',
      data: TREES_URL,
    })
    expect(addLayer).toHaveBeenCalledWith(TREE_LAYER, 'building-3d')
  })

  it('extrudes each band from its base to its top', () => {
    expect(TREE_LAYER.paint?.['fill-extrusion-base']).toEqual(['get', 'b'])
    expect(TREE_LAYER.paint?.['fill-extrusion-height']).toEqual(['get', 'h'])
  })
})

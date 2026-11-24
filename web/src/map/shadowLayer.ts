import type { Map as MapLibreMap, MapGeoJSONFeature } from 'maplibre-gl'
import type { SunPosition } from '../sun/sunState.ts'
import { BUILDING_HEIGHT_SCALE, RELIEF_ZOOM } from './camera.ts'
import { buildingShadow, type LonLat } from './shadows.ts'

type ShadowFeature = {
  type: 'Feature'
  /** Unique, so the map can take just the new ones (GeoJSONSource.updateData). */
  id: number
  geometry: { type: 'MultiPolygon'; coordinates: LonLat[][][] }
  properties: Record<string, never>
}

const EMPTY: ShadowData = { type: 'FeatureCollection', features: [] }

/** Each footprint polygon with all its rings (outer first, then courtyards). */
function polygons(geometry: MapGeoJSONFeature['geometry']): LonLat[][][] {
  if (geometry.type === 'Polygon') return [geometry.coordinates as LonLat[][]]
  if (geometry.type === 'MultiPolygon')
    return geometry.coordinates as LonLat[][][]
  return []
}

/** The map calls a ShadowCache needs: what lets a test stand in for it. */
export type ShadowMap = Pick<MapLibreMap, 'getZoom' | 'querySourceFeatures'>

export type ShadowData = {
  type: 'FeatureCollection'
  features: ShadowFeature[]
}

/**
 * What changed: every shadow (`data`), or only the shadows to add and the
 * ids to remove, so the map isn't sent the whole city on each new street.
 */
export type ShadowChange =
  { data: ShadowData } | { add: ShadowFeature[]; remove: number[] }

/** A building piece: one tile's clip of a building (tiles overlap at edges). */
type Building = { polygons: LonLat[][][]; height: number }

/** Enough for the city centre and around; the oldest buildings go first. */
const MAX_BUILDINGS = 12_000

/**
 * The building shadows, kept as the map moves. Every building piece seen in
 * the loaded vector tiles (OpenMapTiles `building` layer, `render_height` in
 * metres) is remembered with its shadow, so zooming in or out, or coming
 * back to a street, redoes nothing; only pieces new to the cache are cast.
 * A new sun recasts them all.
 */
export class ShadowCache {
  private readonly buildings = new Map<string, Building>()
  private readonly shadows = new Map<string, ShadowFeature[]>()
  private sunKey: string | null = null
  private nextId = 0
  /** The most pieces seen at once per id and height (see addBuildings). */
  private readonly groupSizes = new Map<string, number>()

  /**
   * What to change in the shadows shown, or null for nothing. Below
   * RELIEF_ZOOM, where shadows don't show, no tiles are read.
   */
  update(map: ShadowMap, sun: SunPosition): ShadowChange | null {
    if (sun.altitude <= 0) {
      if (this.sunKey === 'night') return null
      this.sunKey = 'night'
      return { data: EMPTY }
    }
    const sunKey = `${sun.altitude.toFixed(3)},${sun.azimuth.toFixed(3)}`
    const newSun = sunKey !== this.sunKey
    this.sunKey = sunKey
    const { added, removed } =
      map.getZoom() >= RELIEF_ZOOM
        ? this.addBuildings(map)
        : { added: [], removed: [] }
    if (newSun) {
      this.shadows.clear()
      for (const [key, building] of this.buildings)
        this.shadows.set(key, this.cast(building, sun))
      return {
        data: {
          type: 'FeatureCollection',
          features: [...this.shadows.values()].flat(),
        },
      }
    }
    if (added.length === 0 && removed.length === 0) return null
    const add: ShadowFeature[] = []
    for (const key of added) {
      const building = this.buildings.get(key)
      if (!building) continue
      const shadows = this.cast(building, sun)
      this.shadows.set(key, shadows)
      add.push(...shadows)
    }
    return { add, remove: removed }
  }

  /** A building's shadows, each with a new id. */
  private cast(building: Building, sun: SunPosition): ShadowFeature[] {
    return castShadow(building, sun).map((shadow) => ({
      ...shadow,
      id: this.nextId++,
    }))
  }

  /** Remembers the building pieces new to the cache; returns their keys. */
  private addBuildings(map: ShadowMap): {
    added: string[]
    removed: number[]
  } {
    const features = map.querySourceFeatures('openmaptiles', {
      sourceLayer: 'building',
    })
    // Reading a piece's geometry is the costly part, so group the pieces by
    // id and height (cheap to read; ids alone aren't unique) and read only
    // groups with more pieces in view than ever before.
    const groups = new Map<string, typeof features>()
    for (const feature of features) {
      const group = `${feature.id ?? ''}|${feature.properties['render_height'] ?? ''}`
      const list = groups.get(group)
      if (list) list.push(feature)
      else groups.set(group, [feature])
    }
    const added: string[] = []
    for (const [group, list] of groups) {
      if (list.length <= (this.groupSizes.get(group) ?? 0)) continue
      this.groupSizes.set(group, list.length)
      for (const feature of list) {
        const pieces = polygons(feature.geometry)
        const corner = pieces[0]?.[0]?.[0]
        if (!corner) continue
        const key = `${group}|${corner[0].toFixed(6)},${corner[1].toFixed(6)}`
        if (this.buildings.has(key)) continue
        this.buildings.set(key, {
          polygons: pieces,
          // Same exaggeration as the 3D buildings, so shadows match.
          height:
            Number(feature.properties['render_height'] ?? 0) *
            BUILDING_HEIGHT_SCALE,
        })
        added.push(key)
      }
    }
    const removed: number[] = []
    for (const key of this.buildings.keys()) {
      if (this.buildings.size <= MAX_BUILDINGS) break
      this.buildings.delete(key)
      for (const shadow of this.shadows.get(key) ?? []) removed.push(shadow.id)
      this.shadows.delete(key)
    }
    return { added, removed }
  }
}

function castShadow(
  { polygons: list, height }: Building,
  sun: SunPosition,
): Omit<ShadowFeature, 'id'>[] {
  const features: Omit<ShadowFeature, 'id'>[] = []
  if (!(height > 0)) return features
  for (const polygon of list) {
    const quads = buildingShadow(polygon, height, sun)
    if (quads && quads.length > 0)
      features.push({
        type: 'Feature',
        geometry: {
          type: 'MultiPolygon',
          coordinates: quads.map((quad) => [quad]),
        },
        properties: {},
      })
  }
  return features
}

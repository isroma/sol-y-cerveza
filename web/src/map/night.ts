import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'
import { DOTS_LAYER } from './dotLayers.ts'
import { TREES } from './layerIds.ts'

type PaintProperty = Parameters<MapLibreMap['setPaintProperty']>[1]
type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2]

export type PaintPatch = {
  layer: string
  property: PaintProperty
  value: PaintValue
}

/** The grey dots' ring at night: their tan, a step darker. */
const DOT_RING_NIGHT = '#9C8670'

/** Just after sunset: blue hour, dark but still soft. */
const DUSK = {
  background: '#343A52',
  land: '#3A4058',
  green: '#344640',
  water: '#2E4A72',
  building: '#454B62',
  buildingTop: '#525870',
  // The tree crowns: a dark sage, a step lighter than the parks.
  tree: '#4B5E50',
  road: '#535A72',
  text: '#D9DEEA',
  halo: '#343A52',
}

type Palette = Record<keyof typeof DUSK, string>

/** Deep night. */
const NIGHT: Palette = {
  background: '#10131D',
  land: '#161A26',
  green: '#152019',
  water: '#16263D',
  building: '#222838',
  buildingTop: '#2B3144',
  tree: '#22302A',
  road: '#2A3043',
  text: '#AAB2C8',
  halo: '#10131D',
}

/** Mixes two #RRGGBB colours: t = 0 gives `from`, t = 1 gives `to`. */
export function mixHex(from: string, to: string, t: number): string {
  const channel = (hex: string, i: number) =>
    Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return (
    '#' +
    [0, 1, 2]
      .map((i) =>
        Math.round(channel(from, i) + (channel(to, i) - channel(from, i)) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  )
}

/**
 * How deep into the night it is: null while the sun is up, 0 right at sunset,
 * easing to 1 once the sun is 18° below the horizon (true night, about an hour
 * and a half after sunset in Badajoz). Rounded to 0.1 so the map is repainted
 * only when the change is visible.
 */
export function nightDepth(altitude: number): number | null {
  if (altitude > 0) return null
  const t = Math.min(1, -altitude / 18)
  return Math.round(t * t * (3 - 2 * t) * 10) / 10
}

function palette(depth: number): Palette {
  const keys = Object.keys(DUSK) as (keyof Palette)[]
  return Object.fromEntries(
    keys.map((key) => [key, mixHex(DUSK[key], NIGHT[key], depth)]),
  ) as Palette
}

/** The 3D buildings' night colour at `depth`, for layers the switch can't paint. */
export function nightBuildingColor(depth: number): string {
  return palette(depth).buildingTop
}

const isWater = (id: string) => id.startsWith('water')
const isGreen = (id: string) =>
  /park|wood|grass|landcover|garden|pitch/.test(id)

/**
 * A dark map for the night, softer at dusk and darkest overnight (`depth`
 * from 0 to 1). Pure: returns the paint changes for the given style layers.
 */
export function nightPaint(
  layers: readonly LayerSpecification[],
  depth = 1,
): PaintPatch[] {
  const NIGHT = palette(depth)
  const patches: PaintPatch[] = []
  const set = (layer: string, property: PaintProperty, value: PaintValue) =>
    patches.push({ layer, property, value })
  for (const layer of layers) {
    const { id, type } = layer
    if (type === 'background') set(id, 'background-color', NIGHT.background)
    else if (type === 'fill') {
      const color = isWater(id)
        ? NIGHT.water
        : id.startsWith('building')
          ? NIGHT.building
          : isGreen(id)
            ? NIGHT.green
            : NIGHT.land
      set(id, 'fill-color', color)
      set(id, 'fill-outline-color', color)
      // Patterns (wetland, pedestrian areas) ignore fill-color: fade them.
      if (layer.paint && 'fill-pattern' in layer.paint)
        set(id, 'fill-opacity', Math.round((0.35 - 0.23 * depth) * 100) / 100)
    } else if (type === 'fill-extrusion')
      set(
        id,
        'fill-extrusion-color',
        id === TREES ? NIGHT.tree : NIGHT.buildingTop,
      )
    else if (type === 'line')
      set(
        id,
        'line-color',
        id.startsWith('waterway') ? NIGHT.water : NIGHT.road,
      )
    else if (id === DOTS_LAYER) {
      // Venues without a terrace: by night the dot empties into a tan ring,
      // so it stays findable without glowing on the dark map. The selected
      // one stays filled.
      const selected = ['get', 'selected']
      const round = (n: number) => Math.round(n * 100) / 100
      set(id, 'circle-opacity', ['case', selected, 1, round(1 - depth)])
      set(id, 'circle-stroke-color', [
        'case',
        selected,
        '#FFFFFF',
        mixHex('#FFFFFF', DOT_RING_NIGHT, depth),
      ])
      set(id, 'circle-stroke-width', [
        'interpolate',
        ['linear'],
        ['zoom'],
        15.5,
        ['case', selected, 3, round(0.8 + 0.6 * depth)],
        17,
        ['case', selected, 3, round(1.5 + 0.4 * depth)],
      ])
    } else if (type === 'symbol') {
      set(id, 'text-color', NIGHT.text)
      set(id, 'text-halo-color', NIGHT.halo)
    }
  }
  return patches
}

/**
 * Switches the map between day and night paint. The day values are read from
 * the style the first time, so switching back restores them exactly.
 */
export function createNightSwitch(map: MapLibreMap, skip: ReadonlySet<string>) {
  const layers = map.getStyle().layers.filter((layer) => !skip.has(layer.id))
  const patches = nightPaint(layers)
  const day = patches.map((patch): [PaintPatch, PaintValue] => [
    patch,
    // getPaintProperty is typed `unknown`, but it returns exactly what
    // setPaintProperty accepts for the same property.
    map.getPaintProperty(patch.layer, patch.property) as PaintValue,
  ])
  /** `depth` from nightDepth: null for day, 0–1 for dusk to deep night. */
  return (depth: number | null) => {
    const night = depth === null ? null : nightPaint(layers, depth)
    day.forEach(([patch, dayValue], i) => {
      map.setPaintProperty(
        patch.layer,
        patch.property,
        night ? (night[i]?.value ?? dayValue) : dayValue,
      )
    })
  }
}

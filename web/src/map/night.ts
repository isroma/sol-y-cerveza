import type { LayerSpecification, Map as MapLibreMap } from 'maplibre-gl'

type PaintProperty = Parameters<MapLibreMap['setPaintProperty']>[1]
type PaintValue = Parameters<MapLibreMap['setPaintProperty']>[2]

export type PaintPatch = {
  layer: string
  property: PaintProperty
  value: string | number
}

const NIGHT = {
  background: '#10131D',
  land: '#161A26',
  green: '#152019',
  water: '#16263D',
  building: '#222838',
  buildingTop: '#2B3144',
  road: '#2A3043',
  text: '#AAB2C8',
  halo: '#10131D',
}

const isWater = (id: string) => id.startsWith('water')
const isGreen = (id: string) =>
  /park|wood|grass|landcover|garden|pitch/.test(id)

/**
 * A dark map for the night, so it reads as night at a glance. Pure: returns
 * the paint changes for the given style layers.
 */
export function nightPaint(
  layers: readonly LayerSpecification[],
): PaintPatch[] {
  const patches: PaintPatch[] = []
  const set = (
    layer: string,
    property: PaintProperty,
    value: string | number,
  ) => patches.push({ layer, property, value })
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
        set(id, 'fill-opacity', 0.12)
    } else if (type === 'fill-extrusion')
      set(id, 'fill-extrusion-color', NIGHT.buildingTop)
    else if (type === 'line')
      set(
        id,
        'line-color',
        id.startsWith('waterway') ? NIGHT.water : NIGHT.road,
      )
    else if (type === 'symbol') {
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
  const patches = nightPaint(map.getStyle().layers).filter(
    (patch) => !skip.has(patch.layer),
  )
  const day = patches.map((patch): [PaintPatch, PaintValue] => [
    patch,
    // getPaintProperty is typed `unknown`, but it returns exactly what
    // setPaintProperty accepts for the same property.
    map.getPaintProperty(patch.layer, patch.property) as PaintValue,
  ])
  return (night: boolean) => {
    for (const [patch, dayValue] of day) {
      map.setPaintProperty(
        patch.layer,
        patch.property,
        night ? patch.value : dayValue,
      )
    }
  }
}

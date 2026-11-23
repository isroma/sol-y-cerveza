// Fixed test data for the browser smoke tests: a small terraces.json and a
// stub basemap style, so the tests depend neither on the real data nor on
// the network.

/** 13:00 in Madrid (CEST) on the summer solstice: the sun is about 70° up. */
export const SUNNY_INSTANT = new Date('2026-06-21T11:00:00Z')

type Venue = {
  name: string
  kind: 'bar' | 'pub' | 'cafe' | 'restaurant' | 'biergarten'
  lat: number
  lon: number
  /** Horizon height in tenths of a degree all around; null: no terrace. */
  horizon: number | null
}

const OPEN = 50
const WALLED = 850

/** Open terraces (5° horizon) get the midday sun; walled ones (85°) never do. */
const VENUES: readonly Venue[] = [
  {
    name: 'Bar Sol Uno',
    kind: 'bar',
    lat: 38.8826,
    lon: -6.9698,
    horizon: OPEN,
  },
  {
    name: 'Café Sol Dos',
    kind: 'cafe',
    lat: 38.8789,
    lon: -6.9707,
    horizon: OPEN,
  },
  {
    name: 'Mesón Sol Tres',
    kind: 'restaurant',
    lat: 38.8771,
    lon: -6.9705,
    horizon: OPEN,
  },
  {
    name: 'Pub Sol Cuatro',
    kind: 'pub',
    lat: 38.8752,
    lon: -6.9741,
    horizon: OPEN,
  },
  {
    name: 'Bar Sol Cinco',
    kind: 'bar',
    lat: 38.8731,
    lon: -6.9776,
    horizon: OPEN,
  },
  {
    name: 'Bar Sombra Uno',
    kind: 'bar',
    lat: 38.877,
    lon: -6.9733,
    horizon: WALLED,
  },
  {
    name: 'Café Sombra Dos',
    kind: 'cafe',
    lat: 38.8805,
    lon: -6.9672,
    horizon: WALLED,
  },
  {
    name: 'Bar Sombra Tres',
    kind: 'bar',
    lat: 38.8714,
    lon: -6.9812,
    horizon: WALLED,
  },
  {
    name: 'Bar Sin Terraza',
    kind: 'bar',
    lat: 38.8762,
    lon: -6.969,
    horizon: null,
  },
]

export const VENUE_COUNT = VENUES.length
export const TERRACE_COUNT = VENUES.filter((v) => v.horizon !== null).length
export const SUNNY_COUNT = VENUES.filter((v) => v.horizon === OPEN).length

/** A terraces.json (docs/data-contract.md, version 2) with the venues above. */
export const terracesFile = {
  version: 2,
  generated: '2026-06-01T00:00:00Z',
  sample: false,
  attribution: ['Datos de prueba'],
  terraces: VENUES.map((venue, i) => ({
    id: `test:${i}`,
    name: venue.name,
    kind: venue.kind,
    venue: { lat: venue.lat, lon: venue.lon },
    terrace:
      venue.horizon === null
        ? null
        : { lat: venue.lat + 0.00004, lon: venue.lon + 0.00004 },
    sources: ['test'],
    verified: null,
    horizon:
      venue.horizon === null
        ? null
        : Array.from({ length: 360 }, () => venue.horizon),
  })),
}

/** A 20 m wide, 18 m tall block just north of a venue. */
function building(lat: number, lon: number) {
  const south = lat + 0.0002
  const north = south + 0.00018
  const west = lon - 0.00023
  const east = lon + 0.00023
  return {
    type: 'Feature',
    properties: { render_height: 18 },
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [west, south],
          [east, south],
          [east, north],
          [west, north],
          [west, south],
        ],
      ],
    },
  }
}

/**
 * Stands in for OpenFreeMap's Liberty style: one GeoJSON source under the
 * same id, a background and the 3D building layer the app restyles.
 */
export const basemapStyle = {
  version: 8,
  glyphs: 'https://basemap.test/fonts/{fontstack}/{range}.pbf',
  sources: {
    openmaptiles: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: VENUES.map((v) => building(v.lat, v.lon)),
      },
      attribution: 'OpenFreeMap © OpenMapTiles Data from OpenStreetMap',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: {} },
    {
      id: 'building-3d',
      type: 'fill-extrusion',
      source: 'openmaptiles',
      paint: {},
    },
  ],
}

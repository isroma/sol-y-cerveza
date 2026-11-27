import type { DayTrack } from '../sun/dayTrack.ts'
import { unpackHorizon } from '../sun/leafOff.ts'
import type { ProbeCell, ProbeResult } from './probe.ts'
import { sunSummary } from './sunSummary.ts'

/** Metres per degree of latitude (the pipeline's envelope uses the same). */
const M_PER_DEG_LAT = 111_320
/** The LiDAR grid's cell size: each sample is the centre of one 2 m cell. */
const CELL_M = 2

export type SunCellProperties = {
  /** Minutes of sun today; null for a cell the envelope leaves out. */
  minutes: number | null
  skip: ProbeCell['skip']
}

export type SunCellCollection = {
  type: 'FeatureCollection'
  features: {
    type: 'Feature'
    geometry: { type: 'Polygon'; coordinates: [number, number][][] }
    properties: SunCellProperties
  }[]
}

/** The cell's horizon for the day, or null when left out or malformed. */
function cellHorizon(cell: ProbeCell, leafOff: boolean): number[] | null {
  const packed = (leafOff ? cell.horizon_winter : null) ?? cell.horizon
  return packed === null ? null : unpackHorizon(packed)
}

/**
 * The envelope's cells round the pin as 2 m squares (north-up; the LiDAR grid
 * runs about 1.3° off north, under 5 cm across a cell), each with today's
 * minutes of sun, for the admin map.
 */
export function sunCells(
  result: ProbeResult,
  track: DayTrack,
  leafOff: boolean,
): SunCellCollection {
  return {
    type: 'FeatureCollection',
    features: result.cells.map((cell) => {
      const dLat = CELL_M / 2 / M_PER_DEG_LAT
      const dLon =
        CELL_M / 2 / (M_PER_DEG_LAT * Math.cos((cell.lat * Math.PI) / 180))
      const horizon = cellHorizon(cell, leafOff)
      return {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [
              [cell.lon - dLon, cell.lat - dLat],
              [cell.lon + dLon, cell.lat - dLat],
              [cell.lon + dLon, cell.lat + dLat],
              [cell.lon - dLon, cell.lat + dLat],
              [cell.lon - dLon, cell.lat - dLat],
            ],
          ],
        },
        properties: {
          minutes: horizon === null ? null : sunSummary(horizon, track).minutes,
          skip: cell.skip,
        },
      }
    }),
  }
}

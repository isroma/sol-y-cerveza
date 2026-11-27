import { z } from 'zod'
import { insideBadajoz } from '../data/geo.ts'
import { unpackHorizon } from '../sun/leafOff.ts'
import { ADMIN_ENDPOINTS } from './endpoints.ts'

/**
 * The sun probe: horizon, envelope and height above ground at one point, computed by
 * `python -m solycerveza.probe` (pipeline/src/solycerveza/probe.py) and served
 * by the dev server at ADMIN_ENDPOINTS.probe. Pure: shared by the admin page and its
 * dev-server endpoint.
 */

/** Positions are rounded to 5 decimals (about 1 m) for requests and the cache. */
const DECIMALS = 5

export type Position = { lat: number; lon: number }

const tenths = z.array(z.number().int().min(0).max(900)).length(360)

/** Why the envelope leaves a cell out (pipeline: envelope.SKIP_REASONS). */
export const SKIP_REASONS = ['no_data', 'raised', 'building', 'road'] as const

const probeCellSchema = z.object({
  lat: z.number(),
  lon: z.number(),
  skip: z.enum(SKIP_REASONS).nullable(),
  // Packed like the envelope; null for a cell left out.
  horizon: z.string().nullable(),
  // Null when the same as `horizon` or there is no leaf-off model.
  horizon_winter: z.string().nullable(),
})

export const probeResultSchema = z.object({
  // Tenths of a degree per compass azimuth bin, as in terraces.json.
  horizon: tenths,
  // The same with deciduous crowns bare; null when the same or no leaf-off model.
  horizon_winter: tenths.nullable(),
  // The envelope across the terrace, packed as in terraces.json (docs/data-contract.md,
  // "Horizon envelope"); null when the build would leave it out.
  horizon_low: z.string().nullable(),
  // The envelope on the leaf-off model; null without one.
  horizon_low_winter: z.string().nullable(),
  // The envelope's sample cells round the pin, for the admin map.
  cells: z.array(probeCellSchema),
  // Surface minus terrain at the point, metres; null where a raster has no data.
  height_above_ground: z.number().nullable(),
  // The build's threshold for "on a roof or under a canopy" (MAX_HEIGHT_ABOVE_GROUND_M).
  max_height_above_ground: z.number().positive(),
})

export const probeErrorSchema = z.object({
  error: z.string().min(1),
  missing_rasters: z.boolean().optional(),
})

/** One line of the probe's stdout, also the endpoint's response body. */
export const probeOutputSchema = z.union([probeResultSchema, probeErrorSchema])

export type ProbeResult = z.infer<typeof probeResultSchema>
export type ProbeCell = z.infer<typeof probeCellSchema>
export type ProbeOutput = z.infer<typeof probeOutputSchema>

const NUMBER = /^-?\d{1,3}(\.\d+)?$/

export function roundPosition(at: Position): Position {
  const factor = 10 ** DECIMALS
  return {
    lat: Math.round(at.lat * factor) / factor,
    lon: Math.round(at.lon * factor) / factor,
  }
}

/** Cache key for a position: the same for every point that rounds alike. */
export function probeKey(at: Position): string {
  const { lat, lon } = roundPosition(at)
  return `${lat.toFixed(DECIMALS)},${lon.toFixed(DECIMALS)}`
}

export function probeUrl(at: Position): string {
  const { lat, lon } = roundPosition(at)
  return `${ADMIN_ENDPOINTS.probe}?lat=${lat.toFixed(DECIMALS)}&lon=${lon.toFixed(DECIMALS)}`
}

/**
 * The position in a probe request's query string, or why it is refused:
 * both must be plain decimal numbers inside BADAJOZ_BBOX (the probe refuses
 * anything outside).
 */
export function parseProbeQuery(
  params: URLSearchParams,
): { ok: true; at: Position } | { ok: false; error: string } {
  const lat = params.get('lat') ?? ''
  const lon = params.get('lon') ?? ''
  if (!NUMBER.test(lat) || !NUMBER.test(lon))
    return { ok: false, error: 'lat and lon must be decimal numbers' }
  const at = roundPosition({ lat: Number(lat), lon: Number(lon) })
  if (!insideBadajoz(at))
    return { ok: false, error: 'the position is outside the Badajoz area' }
  return { ok: true, at }
}

/** The probe's stdout: the last non-empty line must be one JSON object. */
export function parseProbeOutput(stdout: string): ProbeOutput | null {
  const line = stdout.trim().split('\n').at(-1) ?? ''
  try {
    const parsed = probeOutputSchema.safeParse(JSON.parse(line))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** A pin this high above the terrain is on a roof or under a canopy. */
export function isTooHigh(result: ProbeResult): boolean {
  const height = result.height_above_ground
  return height !== null && height > result.max_height_above_ground
}

/** A packed horizon in tenths, or null when absent or malformed. */
function unpacked(packed: string | null): readonly number[] | null {
  return packed === null ? null : unpackHorizon(packed)
}

/**
 * The horizon the app answers from at this position, as in
 * docs/data-contract.md (steps 6 and 7): the envelope across the terrace when
 * there is one (and it is well formed), else the pin's horizon; in the
 * leaf-off period the leaf-off ones first.
 */
export function terraceHorizon(
  result: ProbeResult,
  leafOff = false,
): readonly number[] {
  if (leafOff)
    return (
      unpacked(result.horizon_low_winter) ??
      unpacked(result.horizon_low) ??
      result.horizon_winter ??
      result.horizon
    )
  return unpacked(result.horizon_low) ?? result.horizon
}

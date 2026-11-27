import { z } from 'zod'
import type { Terrace } from '../data/terraces.ts'
import { unpackHorizon } from '../sun/leafOff.ts'
import { horizonBin } from '../sun/sunState.ts'
import { formatClock, toMadridLocal } from '../time/madrid.ts'

/**
 * Visitor sun reports ("the sun is on this terrace now" where the model says
 * shade, issue #364), as the API's `GET /v1/admin/sun` serves them (proxied
 * by the dev server): pending reports only, one entry per venue and season.
 * Accepting or rejecting one is saved in the API; accepted ones are then
 * copied into pipeline/data/sun_corrections.csv for Publish
 * (useSunCorrections.ts). Pure.
 */
const sightingSchema = z.object({
  id: z.number().int(),
  /** Degrees, compass (0 = north, clockwise), at the server's instant. */
  azimuth: z.number(),
  /** Degrees above the horizon. */
  altitude: z.number(),
  at: z.string(),
})
export type SunSighting = z.infer<typeof sightingSchema>

export const sunReportSchema = z.object({
  ids: z.array(z.number().int()).min(1),
  venueId: z.string(),
  /** Made from 1 Dec to 15 Mar (Madrid date): counts for the leaf-off season only. */
  leafOff: z.boolean(),
  /** Sun seen where the model says shade, or shade where it says sun (ADR-0014); an API before #527 sends none. */
  kind: z.enum(['sun', 'shade']).default('sun'),
  sightings: z.array(sightingSchema).min(1),
  /** Distinct networks. */
  reporters: z.number().int(),
  /** Part of a consensus the public `/v1/sun` already serves (as "~"). */
  shown: z.boolean(),
  last: z.string(),
})
export type SunReport = z.infer<typeof sunReportSchema>

export const sunResponseSchema = z.object({
  reports: z.array(sunReportSchema),
})

/** Distinct networks the API needs before it serves a sun report (as "~"). */
export const SUN_THRESHOLD = 3

/** Degrees either side of a sighting's azimuth that a report covers and a reject blocks. */
export const SUN_SPREAD_DEGREES = 5
/** The same for a shade report (ADR-0014). */
export const SHADE_SPREAD_DEGREES = 2

export const seasonLabel = (leafOff: boolean) =>
  leafOff ? 'leaf-off' : 'leaf-on'

const people = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`

/** One line (the row's tag already says "Sun"): "leaf-on · 3 people · shown as ~", "shade · leaf-on · 3 people · shown". */
export function describeSunReport(
  report: SunReport,
  venueKnown: boolean,
): string {
  const shade = report.kind === 'shade'
  const parts = [
    ...(shade ? ['shade'] : []),
    seasonLabel(report.leafOff),
    people(report.reporters),
  ]
  if (report.shown) parts.push(shade ? 'shown' : 'shown as ~')
  if (!venueKnown) parts.push('stale: no longer in the data')
  return parts.join(' · ')
}

/** What terraces.json says in one direction, in degrees. */
export type ModelAt = {
  /** The obstacle the app compares the sun with (the envelope's low half when the data has one). */
  obstacle: number
  /** The single horizon at the terrace pin, when it differs from `obstacle`. */
  atPin: number | null
}

/**
 * The published model for `terrace` in `azimuth`'s bin, in the report's
 * season: the leaf-off horizons when the report is leaf-off and the data has
 * them, the leaf-on ones otherwise. Mirrors the app (venueStatus.ts: the
 * envelope's low half, else the horizon). Null without a horizon.
 */
export function modelAt(
  terrace: Pick<
    Terrace,
    'horizon' | 'horizon_winter' | 'horizon_low' | 'horizon_low_winter'
  >,
  leafOff: boolean,
  azimuth: number,
): ModelAt | null {
  if (terrace.horizon === null) return null
  const single = (leafOff ? terrace.horizon_winter : null) ?? terrace.horizon
  const packed =
    (leafOff ? terrace.horizon_low_winter : null) ?? terrace.horizon_low
  const low = packed ? unpackHorizon(packed) : null
  const bin = horizonBin(azimuth)
  const pin = single[bin]
  if (pin === undefined) return null
  const lowBin = low?.[bin]
  if (lowBin === undefined) return { obstacle: pin / 10, atPin: null }
  return { obstacle: lowBin / 10, atPin: lowBin === pin ? null : pin / 10 }
}

/** A sighting as the owner reads it. */
export type SightingRow = {
  id: number
  /** "2026-11-25 13:31", Madrid local. */
  when: string
  azimuth: number
  altitude: number
  model: ModelAt | null
  /** Degrees the sun was below the model's obstacle (negative: the model already says sun). */
  below: number | null
}

/** The sightings, oldest first, each next to the model in its direction. */
export function sightingRows(
  report: SunReport,
  terrace: Parameters<typeof modelAt>[0] | undefined,
): SightingRow[] {
  return [...report.sightings]
    .sort((a, b) => a.at.localeCompare(b.at))
    .map((s) => {
      const local = toMadridLocal(new Date(s.at))
      const model = terrace ? modelAt(terrace, report.leafOff, s.azimuth) : null
      return {
        id: s.id,
        when: `${local.date} ${formatClock(local.minutes)}`,
        azimuth: s.azimuth,
        altitude: s.altitude,
        model,
        below:
          model === null
            ? null
            : Math.round((model.obstacle - s.altitude) * 10) / 10,
      }
    })
}

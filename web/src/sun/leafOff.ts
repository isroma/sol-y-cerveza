import type { Terrace } from '../data/terraces.ts'

/**
 * The leaf-off period (docs/adr/0007-seasonal-trees.md, #526): deciduous trees
 * count as bare from the day Sentinel-2 saw them bare this autumn
 * (`leaf_off_from` in terraces.json) until the day it saw them in leaf again
 * (`leaf_off_until`, the first day in leaf), by Madrid date. Without those
 * dates, or with dates outside the windows the pipeline looks in, these
 * month-days apply: leaf-off from 1 December at the latest and until 15 April
 * at the latest, both inclusive. Mirrored in api/src/sun.ts.
 */
export const LEAF_OFF = { from: '12-01', until: '04-15' } as const
/** The earliest observed start and end the app accepts (pipeline: solycerveza.season). */
export const LEAF_OFF_SEEN = { from: '10-01', until: '03-01' } as const

/** The dates Sentinel-2 saw, as terraces.json has them (YYYY-MM-DD). */
export type LeafOffSeen = {
  leaf_off_from?: string | null | undefined
  leaf_off_until?: string | null | undefined
}

const DATE = /^(\d{4})-(\d{2}-\d{2})$/

let published: LeafOffSeen = {}

/** Called once the data loads: isLeafOff then follows the dates it carries. */
export function setLeafOffSeen(seen: LeafOffSeen): void {
  published = {
    leaf_off_from: seen.leaf_off_from ?? null,
    leaf_off_until: seen.leaf_off_until ?? null,
  }
}

/** `day` when it is a date from `earliest` to `latest`, else null. */
function within(
  day: string | null | undefined,
  earliest: string,
  latest: string,
): string | null {
  if (!day || !DATE.test(day)) return null
  return day >= earliest && day <= latest ? day : null
}

/**
 * True when `date` (YYYY-MM-DD, Madrid) is inside the leaf-off period of its
 * season (July to June), going by `seen` (the loaded data's dates by default).
 */
export function isLeafOff(
  date: string,
  seen: LeafOffSeen = published,
): boolean {
  const match = DATE.exec(date)
  if (!match) return false
  const year = Number(match[1])
  const autumn = (match[2] ?? '') >= '07-01' ? year : year - 1
  const spring = autumn + 1
  const latestStart = `${autumn}-${LEAF_OFF.from}`
  const latestEnd = `${spring}-${LEAF_OFF.until}`
  const start =
    within(
      seen.leaf_off_from,
      `${autumn}-${LEAF_OFF_SEEN.from}`,
      latestStart,
    ) ?? latestStart
  const end = within(
    seen.leaf_off_until,
    `${spring}-${LEAF_OFF_SEEN.until}`,
    latestEnd,
  )
  return date >= start && (end === null ? date <= latestEnd : date < end)
}

/**
 * The horizon that answers for `venue` on `date`: the leaf-off one inside the
 * period when the data has it, else the full one.
 */
export function horizonFor(
  venue: Pick<Terrace, 'horizon' | 'horizon_winter'>,
  date: string,
): readonly number[] | null {
  if (venue.horizon === null) return null
  if (isLeafOff(date) && venue.horizon_winter) return venue.horizon_winter
  return venue.horizon
}

type EnvelopeFields = Pick<
  Terrace,
  'horizon' | 'horizon_low' | 'horizon_low_winter'
>

/**
 * A packed horizon (docs/data-contract.md, "Horizon envelope": 360
 * characters of whole degrees, "#" = 0° to "~" = 90° without "\\") in
 * tenths of a degree, like `horizon`; null when it is malformed.
 */
export function unpackHorizon(packed: string): number[] | null {
  if (packed.length !== 360) return null
  const tenths: number[] = []
  for (let i = 0; i < 360; i++) {
    const code = packed.charCodeAt(i)
    if (code < 35 || code > 126 || code === 92) return null
    tenths.push((code - 35 - (code > 92 ? 1 : 0)) * 10)
  }
  return tenths
}

/**
 * The lowest obstacle over the ground points across `venue`'s terrace on
 * `date` (the envelope's low half): the terrace has sun when the sun clears
 * it, that is when any part of the terrace is in sun. Inside the leaf-off
 * period the leaf-off one when the data has it. Null without an envelope (or
 * with a malformed one): the single horizon answers. Decoded on each call
 * (once per venue per day).
 */
export function anySunHorizon(
  venue: EnvelopeFields,
  date: string,
): readonly number[] | null {
  if (venue.horizon === null) return null
  const packed =
    (isLeafOff(date) ? venue.horizon_low_winter : null) ?? venue.horizon_low
  return packed ? unpackHorizon(packed) : null
}

/**
 * The leaf-off twin of the horizon that answers for `venue` in the leaf-on
 * season (ADR-0015): `horizon_low_winter` when the envelope answers,
 * `horizon_winter` when the single horizon does. Null when the twin is absent
 * (the same as the leaf-on one: no deciduous crowns) or malformed.
 */
export function bareTwin(
  venue: Pick<
    Terrace,
    'horizon' | 'horizon_winter' | 'horizon_low' | 'horizon_low_winter'
  >,
): readonly number[] | null {
  if (venue.horizon === null) return null
  if (venue.horizon_low && unpackHorizon(venue.horizon_low)) {
    return venue.horizon_low_winter
      ? unpackHorizon(venue.horizon_low_winter)
      : null
  }
  return venue.horizon_winter ?? null
}

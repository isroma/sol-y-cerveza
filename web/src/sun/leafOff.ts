import type { Terrace } from '../data/terraces.ts'

/**
 * The leaf-off period (docs/adr/0007-seasonal-trees.md): from 1 December to
 * 15 March, by Madrid date, deciduous trees count as bare. A rule of thumb;
 * the owner chose this wider window, accepting more risk at the edges.
 * Month-day strings, both ends inclusive.
 */
export const LEAF_OFF = { from: '12-01', until: '03-15' } as const

const DATE = /^\d{4}-(\d{2}-\d{2})$/

/** True when `date` (YYYY-MM-DD, Madrid) is inside the leaf-off period. */
export function isLeafOff(date: string): boolean {
  const monthDay = DATE.exec(date)?.[1]
  if (monthDay === undefined) return false
  return monthDay >= LEAF_OFF.from || monthDay <= LEAF_OFF.until
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

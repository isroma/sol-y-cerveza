import type { Terrace } from '../data/terraces.ts'
import type { Envelope } from './sunState.ts'

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
  | 'horizon'
  | 'horizon_low'
  | 'horizon_high'
  | 'horizon_low_winter'
  | 'horizon_high_winter'
>

/**
 * The envelope across `venue`'s terrace on `date`, or null when it has none
 * (every point sees the single horizon): inside the leaf-off period the
 * leaf-off one when the data has it, else the full one.
 */
export function envelopeFor(
  venue: EnvelopeFields,
  date: string,
): Envelope | null {
  if (venue.horizon === null) return null
  if (isLeafOff(date) && venue.horizon_low_winter && venue.horizon_high_winter)
    return { low: venue.horizon_low_winter, high: venue.horizon_high_winter }
  if (venue.horizon_low && venue.horizon_high)
    return { low: venue.horizon_low, high: venue.horizon_high }
  return null
}

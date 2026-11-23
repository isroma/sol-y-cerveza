import type { Terrace } from '../data/terraces.ts'

/**
 * The leaf-off period (docs/adr/0007-seasonal-trees.md): from 15 December to
 * the end of February, by Madrid date, deciduous trees count as bare. A rule
 * of thumb that keeps to the core of the season, so it errs towards shade.
 * Month-day strings, both ends inclusive.
 */
export const LEAF_OFF = { from: '12-15', until: '02-29' } as const

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

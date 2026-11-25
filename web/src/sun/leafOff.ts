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

/** Whole degrees 0–90, one character each: "#" (35) to "~" (126) without "\\". */
function unpackChar(code: number): number {
  return code - 35 - (code > 92 ? 1 : 0)
}

/**
 * A packed envelope (docs/data-contract.md, "Horizon envelope") in tenths
 * of a degree, like `horizon`; null when it is malformed: not 360 valid
 * characters each, or the low half above the high one in some bin.
 */
export function unpackEnvelope(low: string, high: string): Envelope | null {
  if (low.length !== 360 || high.length !== 360) return null
  const lows: number[] = []
  const highs: number[] = []
  for (let i = 0; i < 360; i++) {
    const a = low.charCodeAt(i)
    const b = high.charCodeAt(i)
    if (a < 35 || a > 126 || a === 92 || b < 35 || b > 126 || b === 92)
      return null
    const lo = unpackChar(a)
    const hi = unpackChar(b)
    if (lo > hi) return null
    lows.push(lo * 10)
    highs.push(hi * 10)
  }
  return { low: lows, high: highs }
}

/**
 * The envelope across `venue`'s terrace on `date`, or null when it has none
 * (every point sees the single horizon): inside the leaf-off period the
 * leaf-off one when the data has it, else the full one. Decoded on each
 * call, so call it only when partial sun is on.
 */
export function envelopeFor(
  venue: EnvelopeFields,
  date: string,
): Envelope | null {
  if (venue.horizon === null) return null
  if (isLeafOff(date) && venue.horizon_low_winter && venue.horizon_high_winter)
    return unpackEnvelope(venue.horizon_low_winter, venue.horizon_high_winter)
  if (venue.horizon_low && venue.horizon_high)
    return unpackEnvelope(venue.horizon_low, venue.horizon_high)
  return null
}

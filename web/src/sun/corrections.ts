import { useSyncExternalStore } from 'react'
import * as z from 'zod/mini'
import { PRICES_API } from '../apiClient.ts'

/**
 * Visitors' sun reports (issue #364, docs/adr/0012-sun-reports.md): where 3
 * networks saw sun the model calls shade, the API serves a cap on the
 * terrace's horizon over a run of bins, for one season. The app uses
 * min(model, cap) there. Unconfirmed caps make that sun approximate ("~");
 * caps the owner accepted look like plain sun.
 */

const correctionSchema = z.object({
  venueId: z.string(),
  leafOff: z.boolean(),
  from: z.int().check(z.gte(0), z.lte(359)),
  to: z.int().check(z.gte(0), z.lte(359)),
  /** The cap, in tenths of a degree like `horizon`. */
  altitude: z.int().check(z.gte(0), z.lte(900)),
  confirmed: z.boolean(),
  reporters: z.int(),
  last: z.string(),
})

/** The answer's shape is checked strictly, each correction on its own. */
const answerSchema = z.object({ corrections: z.array(z.unknown()) })

export type SunCorrection = z.infer<typeof correctionSchema>

/**
 * The corrections in an API answer. One this client can't read is left out
 * instead of discarding all of them; an answer of the wrong shape throws.
 */
export function parseSunCorrections(body: unknown): SunCorrection[] {
  return answerSchema.parse(body).corrections.flatMap((entry) => {
    const parsed = correctionSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })
}

let loading: Promise<SunCorrection[]> | null = null
let latest: SunCorrection[] = []
const listeners = new Set<() => void>()
let requests = 0

function fetchCorrections(fresh: boolean): Promise<SunCorrection[]> {
  if (!PRICES_API) return Promise.resolve([])
  const mine = ++requests
  return fetch(`${PRICES_API}/v1/sun`, fresh ? { cache: 'no-store' } : {})
    .then((response) => response.json())
    .then(parseSunCorrections)
    .catch(() => latest)
    .then((corrections) => {
      // An older, slower answer never replaces a newer one.
      if (mine !== requests) return latest
      latest = corrections
      for (const listener of listeners) listener()
      return corrections
    })
}

/** Sun corrections from the API, fetched once per page load; [] on any failure. */
export function loadSunCorrections(): Promise<SunCorrection[]> {
  loading ??= fetchCorrections(false)
  return loading
}

/** Fetches again, e.g. right after the owner reported sun. */
export function refreshSunCorrections(): Promise<SunCorrection[]> {
  loading = fetchCorrections(true)
  return loading
}

/** The latest corrections; re-renders when they change. */
export function useSunCorrections(): SunCorrection[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      void loadSunCorrections()
      return () => listeners.delete(listener)
    },
    () => latest,
  )
}

/** Each venue's corrections, for looking them up while building the day. */
export function correctionsByVenue(
  corrections: readonly SunCorrection[],
): Map<string, SunCorrection[]> {
  const byVenue = new Map<string, SunCorrection[]>()
  for (const correction of corrections) {
    const list = byVenue.get(correction.venueId)
    if (list) list.push(correction)
    else byVenue.set(correction.venueId, [correction])
  }
  return byVenue
}

/** The bins of a run, inclusive at both ends; one with from > to crosses north. */
export function runBins(from: number, to: number): number[] {
  const bins: number[] = []
  for (let bin = from; ; bin = (bin + 1) % 360) {
    bins.push(bin)
    if (bin === to || bins.length === 360) return bins
  }
}

/**
 * A venue's horizons after its corrections for one season: `all` with every
 * cap (what the app shows), `confirmed` with the owner's alone (what is sure).
 * `confirmed` is null when every cap is confirmed, so nothing is approximate;
 * the whole result is null when no correction applies.
 */
export type CorrectedHorizons = {
  all: readonly number[]
  confirmed: readonly number[] | null
}

export function correctHorizon(
  horizon: readonly number[],
  corrections: readonly SunCorrection[],
  leafOff: boolean,
): CorrectedHorizons | null {
  const here = corrections.filter((c) => c.leafOff === leafOff)
  if (here.length === 0) return null
  const all = [...horizon]
  const confirmed = [...horizon]
  let approximate = false
  for (const { from, to, altitude, confirmed: sure } of here) {
    for (const bin of runBins(from, to)) {
      const model = horizon[bin]
      if (model === undefined || altitude >= model) continue
      all[bin] = Math.min(all[bin] ?? model, altitude)
      if (sure) confirmed[bin] = Math.min(confirmed[bin] ?? model, altitude)
      else approximate = true
    }
  }
  return { all, confirmed: approximate ? confirmed : null }
}

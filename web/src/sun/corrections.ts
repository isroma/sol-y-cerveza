import { useSyncExternalStore } from 'react'
import * as z from 'zod/mini'
import { PRICES_API } from '../apiClient.ts'
import type { Terrace } from '../data/terraces.ts'

/**
 * Visitors' sun reports (issue #364, docs/adr/0012-sun-reports.md): where 3
 * networks saw sun the model calls shade, the API serves a cap on the
 * terrace's horizon over a run of bins, for one season. The app uses
 * min(model, cap) there. Unconfirmed caps make that sun approximate ("~");
 * caps the owner accepted look like plain sun.
 *
 * Shade reports (#527, docs/adr/0014-shade-reports.md) work the other way:
 * a floor raises the horizon, served in the answer's `shade` list. The app
 * uses min(max(model, floor), cap): caps win. Shade from a floor shows as
 * plain shade, confirmed or not (the app has no approximate shade).
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
const answerSchema = z.object({
  corrections: z.array(z.unknown()),
  // Shade floors (ADR-0014); absent from an API before #527.
  shade: z.optional(z.array(z.unknown())),
})

/** A run from the API: a cap, or with `floor` a shade report's floor. */
export type SunCorrection = z.infer<typeof correctionSchema> & {
  floor?: boolean
}

/** What applying a correction needs: the API's and the dataset's alike. */
export type HorizonCap = Pick<
  SunCorrection,
  'leafOff' | 'from' | 'to' | 'altitude' | 'confirmed' | 'floor'
>

/**
 * A record's own `sun_corrections` and `shade_corrections` (terraces.json,
 * issues #463 and #527): the owner's accepted reports, so confirmed caps and
 * floors, applied with or without the API.
 */
export function datasetCaps(venue: Terrace): HorizonCap[] {
  const caps = (venue.sun_corrections ?? []).map((c) => ({
    leafOff: c.leaf_off,
    from: c.from,
    to: c.to,
    altitude: c.altitude,
    confirmed: true,
  }))
  const floors = (venue.shade_corrections ?? []).map((c) => ({
    leafOff: c.leaf_off,
    from: c.from,
    to: c.to,
    altitude: c.altitude,
    confirmed: true,
    floor: true,
  }))
  return [...caps, ...floors]
}

/**
 * The corrections in an API answer, caps and then floors. One this client
 * can't read is left out instead of discarding all of them; an answer of the
 * wrong shape throws.
 */
export function parseSunCorrections(body: unknown): SunCorrection[] {
  const { corrections, shade = [] } = answerSchema.parse(body)
  const read = (entry: unknown) => {
    const parsed = correctionSchema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  }
  return [
    ...corrections.flatMap(read),
    ...shade.flatMap((entry) =>
      read(entry).map((c) => ({ ...c, floor: true })),
    ),
  ]
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

/** A bin is deciduous crown when the leaf-off twin is at least this much lower (tenths, ADR-0015). */
export const CROWN_MIN_DROP = 10

/**
 * The caps a leaf-on sun cap adds across the deciduous crowns it contradicts
 * (ADR-0015): every crown bin (`bare` at least CROWN_MIN_DROP below
 * `horizon`) connected without a gap to a bin where the cap is below the
 * model gets a one-bin cap at `bare` there, with the cap's `confirmed`.
 */
export function crownSpans(
  horizon: readonly number[],
  bare: readonly number[],
  cap: HorizonCap,
): HorizonCap[] {
  const crown = (bin: number) => {
    const model = horizon[bin]
    const leafless = bare[bin]
    return (
      model !== undefined &&
      leafless !== undefined &&
      leafless + CROWN_MIN_DROP <= model
    )
  }
  const spanned = new Set<number>()
  const visit = (start: number) => {
    // Walk both ways from a contradicted crown bin while the crown goes on.
    for (const step of [1, -1]) {
      for (
        let bin = start, n = 0;
        n < 360 && crown(bin);
        bin = (bin + step + 360) % 360, n++
      )
        spanned.add(bin)
    }
  }
  for (const bin of runBins(cap.from, cap.to)) {
    const model = horizon[bin]
    if (model !== undefined && cap.altitude < model && crown(bin)) visit(bin)
  }
  return [...spanned]
    .sort((a, b) => a - b)
    .map((bin) => ({
      leafOff: false,
      from: bin,
      to: bin,
      altitude: bare[bin] ?? 0,
      confirmed: cap.confirmed,
    }))
}

/**
 * `bare` is the leaf-off twin of `horizon` (bareTwin in leafOff.ts): with it,
 * a leaf-on sun cap also lowers the whole deciduous crown it contradicts to
 * the leaf-off horizon (crownSpans, ADR-0015).
 */
export function correctHorizon(
  horizon: readonly number[],
  corrections: readonly HorizonCap[],
  leafOff: boolean,
  bare: readonly number[] | null = null,
): CorrectedHorizons | null {
  const season = corrections.filter((c) => c.leafOff === leafOff)
  if (season.length === 0) return null
  const here =
    leafOff || bare === null
      ? season
      : [
          ...season,
          ...season
            .filter((c) => !c.floor)
            .flatMap((c) => crownSpans(horizon, bare, c)),
        ]
  const all = [...horizon]
  const confirmed = [...horizon]
  let approximate = false
  // Floors first, then caps: where both apply, the cap wins (ADR-0014).
  for (const c of here.filter((c) => c.floor)) {
    for (const bin of runBins(c.from, c.to)) {
      const model = horizon[bin]
      if (model === undefined || c.altitude <= model) continue
      all[bin] = Math.max(all[bin] ?? model, c.altitude)
      if (c.confirmed)
        confirmed[bin] = Math.max(confirmed[bin] ?? model, c.altitude)
      else approximate = true
    }
  }
  for (const c of here.filter((c) => !c.floor)) {
    for (const bin of runBins(c.from, c.to)) {
      const current = all[bin]
      if (current === undefined || c.altitude >= current) continue
      all[bin] = c.altitude
      if (c.confirmed)
        confirmed[bin] = Math.min(confirmed[bin] ?? current, c.altitude)
      else approximate = true
    }
  }
  return { all, confirmed: approximate ? confirmed : null }
}

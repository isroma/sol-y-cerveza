import type { LatLon, Terrace } from '../data/terraces.ts'
import { distanceMetres } from '../data/geo.ts'
import type { Review } from './review.ts'

/**
 * Overture-only venues that are probably not a bar or restaurant, for the
 * admin's batch dismissal. terraces.json carries no Overture confidence or
 * category (the pipeline filters on them and drops them), so the signals are
 * what the file has: the name, the position and the other venues.
 *
 * Strong signals (pre-ticked in the list):
 * - `name`: the name says it is something else (a shop, a tobacconist, a
 *   nightclub, a placeholder such as "Eliminar" or "User123").
 * - `takeaway`: fast food or delivery (kebab, pollería, Telepizza…), which
 *   the pipeline leaves out of Overture on purpose (`NOT_VENUES`).
 * - `other_town`: the name places it in another town.
 * - `duplicate`: a venue with the same name within DUPLICATE_M that comes
 *   from another source or is already reviewed.
 *
 * Weak signals (listed, not ticked):
 * - `duplicate_overture`: the same name within DUPLICATE_M, also Overture-only
 *   (only the second of the pair, by id, is listed).
 * - `far`: more than FAR_M from the centre.
 * - `isolated`: no other venue within ISOLATED_M.
 */
export type JunkSignal =
  | 'name'
  | 'takeaway'
  | 'other_town'
  | 'duplicate'
  | 'duplicate_overture'
  | 'far'
  | 'isolated'

export const STRONG: ReadonlySet<JunkSignal> = new Set([
  'name',
  'takeaway',
  'other_town',
  'duplicate',
])

export const DUPLICATE_M = 300
export const FAR_M = 4000
export const ISOLATED_M = 250

export function normalize(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const NOT_A_VENUE =
  /\b(eliminar|user ?\d+|merceria|regalos?|estanco|airsoft|tienda|panificadora|panaderia|pasteleria|confiteria|floristeria|bouquets?|outlet|discoteca|peluqueria|gimnasio|supermercado|gasolinera|farmacia|club taurino)\b/
const TAKEAWAY =
  /\b(kebab|doner|polleria|pollos asados|telepizza|domino s|mccafe|burger king|mcdonald s)\b/
// A town inside a venue's own name ("Asador Zafra", "Bar Nuevo Lisboa",
// "Sevilla") is common; only a nearby town after other words ("London Café
// Don Benito") counts.
const TRAILING_TOWN =
  /. (don benito|merida|caceres|elvas|olivenza|montijo|almendralejo)$/

export const JUNK_LABELS: Record<JunkSignal, string> = {
  name: 'name says it is not a bar or restaurant',
  takeaway: 'fast food or delivery',
  other_town: 'name places it in another town',
  duplicate: 'same name as a nearby venue from another source',
  duplicate_overture: 'same name as a nearby Overture venue',
  far: `more than ${FAR_M / 1000} km from the centre`,
  isolated: `no other venue within ${ISOLATED_M} m`,
}

export type JunkItem = { venue: Terrace; signals: JunkSignal[] }

export function isOvertureOnly(venue: Terrace): boolean {
  return venue.sources.length === 1 && venue.sources[0] === 'overture'
}

/**
 * Signals for every venue in `all` (empty for all but Overture-only ones), in
 * the order of JunkSignal. Names are normalised once: this runs on every
 * review change.
 */
export function junkSignalsAll(
  all: readonly Terrace[],
  reviews: ReadonlyMap<string, Review>,
  centre: LatLon,
): Map<string, JunkSignal[]> {
  const others = all
    .filter((v) => reviews.get(v.id)?.status !== 'not_venue')
    .map((v) => ({
      id: v.id,
      at: v.venue,
      name: normalize(v.name),
      // Another source, or reviewed: the Overture one is the copy.
      settled: !isOvertureOnly(v) || reviews.get(v.id)?.status != null,
    }))
  const out = new Map<string, JunkSignal[]>()
  for (const venue of all) {
    if (!isOvertureOnly(venue)) {
      out.set(venue.id, [])
      continue
    }
    const signals: JunkSignal[] = []
    const name = normalize(venue.name)
    if (NOT_A_VENUE.test(name)) signals.push('name')
    if (TAKEAWAY.test(name)) signals.push('takeaway')
    if (TRAILING_TOWN.test(name)) signals.push('other_town')
    let nearest = Infinity
    let duplicate: JunkSignal | null = null
    for (const other of others) {
      if (other.id === venue.id) continue
      const d = distanceMetres(venue.venue, other.at)
      nearest = Math.min(nearest, d)
      if (d > DUPLICATE_M || other.name !== name) continue
      if (other.settled) duplicate = 'duplicate'
      else if (duplicate === null && other.id < venue.id)
        duplicate = 'duplicate_overture'
    }
    if (duplicate) signals.push(duplicate)
    if (distanceMetres(venue.venue, centre) > FAR_M) signals.push('far')
    if (nearest > ISOLATED_M) signals.push('isolated')
    out.set(venue.id, signals)
  }
  return out
}

/** Signals for one venue among `all` (which includes it). */
export function junkSignals(
  venue: Terrace,
  all: readonly Terrace[],
  reviews: ReadonlyMap<string, Review>,
  centre: LatLon,
): JunkSignal[] {
  return junkSignalsAll(all, reviews, centre).get(venue.id) ?? []
}

export function isStrong(signals: readonly JunkSignal[]): boolean {
  return signals.some((s) => STRONG.has(s))
}

/**
 * Unreviewed Overture-only venues with at least one signal: strong ones
 * first, then by name.
 */
export function likelyJunk(
  venues: readonly Terrace[],
  reviews: ReadonlyMap<string, Review>,
  signals: ReadonlyMap<string, readonly JunkSignal[]>,
): JunkItem[] {
  return venues
    .filter((v) => !reviews.get(v.id)?.status)
    .map((venue) => ({
      venue,
      signals: [...(signals.get(venue.id) ?? [])],
    }))
    .filter((item) => item.signals.length > 0)
    .sort(
      (a, b) =>
        Number(isStrong(b.signals)) - Number(isStrong(a.signals)) ||
        a.venue.name.localeCompare(b.venue.name, 'es'),
    )
}

# `terraces.json` data contract (version 2)

The pipeline writes **`web/public/data/terraces.json`**. The web app fetches it at `./data/terraces.json` and validates it with zod. `python -m solycerveza.build` generates it from real sources, so it holds `"sample": false`; `"sample": true` marks fake data (test fixtures), for which the app shows a notice.

Version 2 (2026-11-24) lists **every named venue**, not only those with a terrace: `terrace` is null when no terrace is known (the app shows "terraza sin confirmar", unconfirmed terrace), and then `verified` and `horizon` are null too. Version 1 only listed venues with a terrace.

A breaking change bumps `version` and updates, in the same PR: this document, the web zod schema and the pipeline pydantic model.

## Shape

```ts
type TerracesFile = {
  version: 2
  generated: string // ISO 8601 UTC timestamp of the pipeline run
  sample: boolean // true while the file holds fake data; the app shows a notice
  attribution: string[] // shown in the app, one line each
  terraces: Terrace[] // one per named venue, sorted by id
}

type Terrace = {
  id: string // stable: "osm:node/123", "osm:way/456", "overture:<GERS id>", "junta:<hash>", "review:<slug>" (added in the admin view), "curated:<slug>", "sample:<slug>"
  name: string
  kind: 'bar' | 'pub' | 'cafe' | 'restaurant' | 'biergarten'
  venue: LatLon // the venue itself (building or entrance)
  terrace: LatLon | null // where the tables are (horizon computed from here); null = no known terrace
  sources: string[] // e.g. ["curated", "osm"], ["overture"], ["junta"] or ["osm", "review"], sorted
  verified: string | null // YYYY-MM-DD of the last on-site check of the terrace position; null if terrace is null
  horizon: number[] | null // 360 integers, see below; null if not computed yet or terrace is null
  horizon_winter?: number[] | null // the same with deciduous trees bare (ADR-0007); null or absent = same as horizon
  horizon_low?: string | null // envelope across the terrace: lowest obstacle per bin, packed (see "Horizon envelope"); absent = same as horizon
  horizon_low_winter?: string | null // the envelope on the leaf-off model; absent = same as horizon_low (or, without it, horizon_winter)
  sun_corrections?: SunCorrection[] // horizon caps from accepted sun reports, summer first, then by from; absent = none
  prices: Price[] // beer prices seen at the venue, caña first, then tercios by brand; [] if none
}

type SunCorrection = {
  leaf_off: boolean // the season it applies in (leaf-off period or not)
  from: number // first horizon bin, 0..359
  to: number // last horizon bin, inclusive; from > to crosses north
  altitude: number // the cap in tenths of a degree, 0..900, margin already off
}

type Price = {
  item: 'cana' | 'tercio' // a draught caña, or a 33 cl bottle
  brand: string | null // tercio only: alhambra-especial, amstel, cruzcampo, estrella-damm, estrella-galicia, heineken, mahou-5-estrellas, sagres, san-miguel, super-bock, or other (a brand not listed); null for a caña
  cents: number // integer euro cents (money is never a float)
  seen: string // YYYY-MM-DD the price was seen
}

type LatLon = { lat: number; lon: number } // WGS84 degrees, max 6 decimals
```

`horizon_winter` (added 2026-11-23, not a breaking change) is the horizon of the _leaf-off surface model_: the surface with deciduous tree crowns lowered to the ground ([ADR-0007](adr/0007-seasonal-trees.md)). Same encoding as `horizon`. The pipeline writes it only where it differs from `horizon`, and `null` everywhere else, including every terrace when the leaf-off model wasn't built. It must be `null` when `horizon` is `null`. Files without the key are valid.

`horizon_low` and `horizon_low_winter` (added 2026-11-25, #409, not a breaking change) are the **horizon envelope** across the terrace; see "Horizon envelope" below. Each needs a `horizon`; the app checks the encoding as it decodes and treats a malformed one as absent. The pipeline leaves the keys out when there is nothing to add, so files without them are valid. Files from #409 to #422 also carried `horizon_high`/`horizon_high_winter` (the highest obstacle); the app ignores them.

`sun_corrections` (added 2026-11-26, issue #463, not a breaking change) holds the visitors' sun reports the owner accepted ([ADR-0012](adr/0012-sun-reports.md)), recorded in `pipeline/data/sun_corrections.csv`. Each entry means the same as a `confirmed: true` correction of `GET /v1/sun`, and the build computes it with the API's rules: each report caps the bins within 5° of `round(azimuth) mod 360` at `max(0, floor((altitude - 2) * 10))`, the lowest report in a bin wins, adjacent bins with the same cap form one entry (across north too), seasons stay apart, and reports seen more than 365 days before `generated` no longer count. It needs a `horizon`; the pipeline leaves the key out when a terrace has none, and the app treats a malformed list as absent, so files without it are valid. The model's horizons stay as they are: the app applies the caps (step 8 below).

`prices` (added 2026-11-23, not a breaking change) holds prices a curator confirmed in the admin view (`pipeline/data/venue_prices.csv`). Prices users suggest are not in this file: the app reads them at runtime from the suggestions API.

## Horizon

- `horizon[i]` is the elevation angle of the highest obstacle seen from the terrace towards compass azimuth `i`° (0 = north, 90 = east, clockwise), **in tenths of a degree**: an integer from 0 to 900.
- Bin `i` covers azimuths `[i - 0.5°, i + 0.5°)`.
- Observer: eye height 1.2 m above the ground at `terrace`.
- Obstacles are everything in the surface model (buildings, trees, terrain) within 300 m. Negative angles (ground dropping away) are clamped to 0.

## Horizon envelope

A terrace is several metres across (usually 5 to 10 tables in one or two rows), and a pin is rarely placed to better than a few metres: moving it 2 m changes the single-point answer at about 7 % of daylight times, and by more than 2 hours a day for about one terrace in five. The envelope samples the terrace instead (`pipeline/src/solycerveza/envelope.py`):

- Points: the pin and the centre of every 2 m cell of the surface model within 7 m of the pin, other than the pin's own cell (about 37 points), in the grid's row order (from the north), west to east. Sampling the raster's own cells keeps the answer steady as the pin moves: moving it 2 m changes the day's sun by a median 30 to 38 min (today, 20 March, 21 June over the published terraces), against 42 to 60 with the 3 m circle used until #524 (8 points, with 4 m and 5 m circles as a fallback).
- A point counts only on open ground: the surface model at most 2 m above the terrain there (parked cars and hedges count, roofs, awnings and tree crowns don't; 1 m until #524), outside every closed OSM structure outline (`leafoff.load_structures`), and off every OSM carriageway (`pipeline/src/solycerveza/roads.py`: road-class ways buffered by their `width`, else `lanes` × 3.25 m, else a default per class; pedestrian and living streets are not carriageways). Tables stand on the pavement: without this, a terrace under a row of street trees would take the sun on the road beside it.
- Each kept point gets a horizon like the pin's (same observer and range). `horizon_low[i]` is the lowest of them in bin `i`: when the sun clears it, some part of the terrace is in sun. The pin is one of the points only when it is on open ground itself, so `horizon` can be lower than `horizon_low`.
- **Packed encoding:** the envelope is a string of exactly 360 characters, one per bin (bin `i` as in `horizon`), in **whole degrees** from 0 to 90. The character with code point `c` stands for `c - 35` degrees below the backslash (`c < 92`) and `c - 36` above it, so the 91 characters run from `#` (0°) to `~` (90°) and none needs escaping in JSON. It is rounded down, so rounding can only add sun, by under 1°. A string parses far faster than 360 numbers.
- `horizon_low` is left out when no point is on open ground, or when it equals `horizon`.
- `horizon_low_winter` is the same on the leaf-off model, left out when it equals `horizon_low` (or, without one, `horizon_winter`).

## Sun / shade rule (client)

1. Compute the sun's altitude `alt` and compass azimuth `az`, in degrees, for the chosen instant at `terrace`.
2. If `alt <= 0`, the result is **night**.
3. Otherwise `bin = round(az) mod 360`: **sun** if `alt * 10 > horizon[bin]`, else **shade**.
4. If `horizon` is `null`, the result is **unknown**.
5. If `terrace` is `null`, there is no state: the app shows the venue at `venue`, greyed out and labelled "terraza sin confirmar" (unconfirmed terrace).
6. **Leaf-off period** (1 December to 15 March, by `Europe/Madrid` date): use `horizon_winter` instead of `horizon` when it is not `null` (ADR-0007).
7. **Envelope**: when the terrace has an envelope (a malformed one counts as absent), it replaces `horizon` in step 3 (and `horizon_winter` in step 6; in the leaf-off period use `horizon_low_winter` when present, else `horizon_low`): with `low` decoded to degrees, **sun** if `alt > low[bin]`, that is when any part of the terrace is in sun, else **shade**. There is no separate partial state.
8. **Visitors' sun** (issue #364, [ADR-0012](adr/0012-sun-reports.md)): the record's own `sun_corrections` are confirmed corrections, applied whether or not the app has an API. In addition, when the build has `VITE_PRICES_API`, the app loads `GET /v1/sun` once per page load and merges its corrections for the venue with the record's. For each correction of the venue whose season (`leaf_off` / `leafOff`) matches the day (`isLeafOff`), the horizon that answers in steps 3, 6 and 7 becomes `min(horizon[bin], altitude)` in every bin from `from` to `to` (inclusive, wrapping across north when `from > to`). The day's sun/shade is then computed as usual, including short shade counting as sun. A step is sun **only by visitors** (shown "~") when it is sun with every correction but not with the `confirmed: true` ones alone; confirmed corrections give plain sun.

`suncalc` 2.x (the version in the lockfile) already returns degrees, with a compass azimuth (0 = north, clockwise) and a refraction-corrected altitude, so no conversion is needed. suncalc 1.x used radians measured from south; don't apply its `+180°` conversion to 2.x.

Times are entered and shown in `Europe/Madrid`.

## Determinism (pipeline output)

- Keys appear in the order above, and `terraces` is sorted by `id`.
- Coordinates are rounded to 6 decimals.
- UTF-8, 2-space indent, each `horizon` and `horizon_winter` array on a single line, trailing newline. Null envelope keys and empty `sun_corrections` are left out; `sun_corrections` entries are sorted by `leaf_off` (false first), then `from`.

These rules keep data refresh PRs reviewable.

## Example record

```json
{
  "id": "sample:plaza-alta",
  "name": "Terraza de ejemplo · Plaza Alta",
  "kind": "restaurant",
  "venue": { "lat": 38.8826, "lon": -6.9698 },
  "terrace": { "lat": 38.88256, "lon": -6.96976 },
  "sources": ["sample"],
  "verified": null,
  "horizon": [83, 83, 83, "… 360 values in total"]
}
```

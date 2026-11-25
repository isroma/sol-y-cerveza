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
  horizon_low?: string | null // envelope across the terrace, lowest obstacle per bin, packed (see "Horizon envelope"); absent = every point sees horizon
  horizon_high?: string | null // the highest obstacle per bin, packed; set together with horizon_low
  horizon_low_winter?: string | null // the envelope on the leaf-off model; absent = same as the envelope above
  horizon_high_winter?: string | null
  prices: Price[] // beer prices seen at the venue, caña first, then tercios by brand; [] if none
}

type Price = {
  item: 'cana' | 'tercio' // a draught caña, or a 33 cl bottle
  brand: string | null // tercio only: cruzcampo, mahou-5-estrellas, estrella-galicia, amstel, heineken, alhambra-especial, san-miguel, estrella-damm, super-bock, sagres; null for a caña
  cents: number // integer euro cents (money is never a float)
  seen: string // YYYY-MM-DD the price was seen
}

type LatLon = { lat: number; lon: number } // WGS84 degrees, max 6 decimals
```

`horizon_winter` (added 2026-11-23, not a breaking change) is the horizon of the *leaf-off surface model*: the surface with deciduous tree crowns lowered to the ground ([ADR-0007](adr/0007-seasonal-trees.md)). Same encoding as `horizon`. The pipeline writes it only where it differs from `horizon`, and `null` everywhere else, including every terrace when the leaf-off model wasn't built. It must be `null` when `horizon` is `null`. Files without the key are valid.

`horizon_low`, `horizon_high`, `horizon_low_winter` and `horizon_high_winter` (added 2026-11-25, #409, not a breaking change) are the **horizon envelope** across the terrace; see "Horizon envelope" below. Each pair is both set or both absent, needs a `horizon`, and has `low[i] <= high[i]` in every bin (the pipeline checks this; the app checks it as it decodes and treats a malformed envelope as absent). The pipeline leaves the keys out when there is nothing to add, so files without them are valid.

`prices` (added 2026-11-23, not a breaking change) holds prices a curator confirmed in the admin view (`pipeline/data/venue_prices.csv`). Prices users suggest are not in this file: the app reads them at runtime from the suggestions API.

## Horizon

- `horizon[i]` is the elevation angle of the highest obstacle seen from the terrace towards compass azimuth `i`° (0 = north, 90 = east, clockwise), **in tenths of a degree**: an integer from 0 to 900.
- Bin `i` covers azimuths `[i - 0.5°, i + 0.5°)`.
- Observer: eye height 1.2 m above the ground at `terrace`.
- Obstacles are everything in the surface model (buildings, trees, terrain) within 300 m. Negative angles (ground dropping away) are clamped to 0.

## Horizon envelope

A terrace is several metres across, and a pin is rarely placed to better than a few metres: moving it 2 m changes the single-point answer at about 7 % of daylight times. The envelope samples the terrace instead (`pipeline/src/solycerveza/envelope.py`):

- Points: the pin and 8 points on a 3 m circle round it, the first due north, then clockwise.
- Fallback: when that leaves no ground point but the pin (pin and circle all under one canopy or crown, on a roof, or inside a building), 12 points on each of a 4 m and a 5 m circle instead, used only if at least 2 of them are on open ground.
- A point counts only on open ground: the surface model at most 1 m above the terrain there (not on a roof, under an awning or under a tree crown), and outside every closed OSM structure outline (`leafoff.load_structures`).
- Each kept point gets a horizon like the pin's (same observer and range). `horizon_low[i]` is the lowest of them in bin `i`, `horizon_high[i]` the highest. The pin is one of the points only when it is on open ground itself, so `horizon` can lie outside the envelope.
- **Packed encoding:** each envelope is a string of exactly 360 characters, one per bin (bin `i` as in `horizon`), in **whole degrees** from 0 to 90. The character with code point `c` stands for `c - 35` degrees below the backslash (`c < 92`) and `c - 36` above it, so the 91 characters run from `#` (0°) to `~` (90°) and none needs escaping in JSON. The low envelope is rounded down and the high one up, so rounding only widens the partial band, by under 1°. A string parses far faster than 360 numbers, and the app decodes it only when it shows partial sun.
- `horizon_low`/`horizon_high` are left out when no point is on open ground, or when every kept point sees exactly `horizon`.
- `horizon_low_winter`/`horizon_high_winter` are the same on the leaf-off model, left out when they equal the summer envelope (or, without one, `horizon_winter` at every point).

## Sun / shade rule (client)

1. Compute the sun's altitude `alt` and compass azimuth `az`, in degrees, for the chosen instant at `terrace`.
2. If `alt <= 0`, the result is **night**.
3. Otherwise `bin = round(az) mod 360`: **sun** if `alt * 10 > horizon[bin]`, else **shade**.
4. If `horizon` is `null`, the result is **unknown**.
5. If `terrace` is `null`, there is no state: the app shows the venue at `venue`, greyed out and labelled "terraza sin confirmar" (unconfirmed terrace).
6. **Leaf-off period** (1 December to 15 March, by `Europe/Madrid` date): use `horizon_winter` instead of `horizon` when it is not `null` (ADR-0007).
7. **Envelope**: when the terrace has an envelope (a malformed one counts as absent), it replaces steps 3 and 6. In the leaf-off period use `horizon_low_winter`/`horizon_high_winter` when present, else `horizon_low`/`horizon_high`. With `low` and `high` decoded to degrees: **sun** if `alt > high[bin]`, **shade** if `alt <= low[bin]`, and **partial** in between (part of the terrace in sun).

`suncalc` 2.x (the version in the lockfile) already returns degrees, with a compass azimuth (0 = north, clockwise) and a refraction-corrected altitude, so no conversion is needed. suncalc 1.x used radians measured from south; don't apply its `+180°` conversion to 2.x.

Times are entered and shown in `Europe/Madrid`.

## Determinism (pipeline output)

- Keys appear in the order above, and `terraces` is sorted by `id`.
- Coordinates are rounded to 6 decimals.
- UTF-8, 2-space indent, each `horizon` and `horizon_winter` array on a single line, trailing newline. Null envelope keys are left out.

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

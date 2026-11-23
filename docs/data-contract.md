# `terraces.json` data contract (version 2)

The pipeline writes **`web/public/data/terraces.json`**. The web app fetches it at `./data/terraces.json` and validates it with zod. Until the build command lands (#12), the file holds sample data (`"sample": true`).

Version 2 (2026-11-24) lists **every named venue**, not only those with a terrace: `terrace` is null when no terrace is known ("terraza sin confirmar"), and then `verified` and `horizon` are null too. Version 1 only listed venues with a terrace.

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
  id: string // stable: "osm:node/123", "osm:way/456", "overture:<GERS id>", "junta:<hash>", "curated:<slug>", "sample:<slug>"
  name: string
  kind: 'bar' | 'pub' | 'cafe' | 'restaurant' | 'biergarten'
  venue: LatLon // the venue itself (building or entrance)
  terrace: LatLon | null // where the tables are (horizon computed from here); null = no known terrace
  sources: string[] // e.g. ["curated", "osm"], ["overture"] or ["junta"], sorted
  verified: string | null // YYYY-MM-DD of the last on-site check of the terrace position; null if terrace is null
  horizon: number[] | null // 360 integers, see below; null if not computed yet or terrace is null
}

type LatLon = { lat: number; lon: number } // WGS84 degrees, max 6 decimals
```

## Horizon

- `horizon[i]` is the elevation angle of the highest obstacle seen from the terrace towards compass azimuth `i`° (0 = north, 90 = east, clockwise), **in tenths of a degree**: an integer from 0 to 900.
- Bin `i` covers azimuths `[i - 0.5°, i + 0.5°)`.
- Observer: eye height 1.2 m above the ground at `terrace`.
- Obstacles are everything in the surface model (buildings, trees, terrain) within 300 m. Negative angles (ground dropping away) are clamped to 0.

## Sun / shade rule (client)

1. Compute the sun's altitude `alt` and compass azimuth `az`, in degrees, for the chosen instant at `terrace`.
2. If `alt <= 0`, the result is **night**.
3. Otherwise `bin = round(az) mod 360`: **sun** if `alt * 10 > horizon[bin]`, else **shade**.
4. If `horizon` is `null`, the result is **unknown**.
5. If `terrace` is `null`, there is no state: the app shows the venue at `venue`, greyed out as "terraza sin confirmar".

`suncalc` 2.x (the version in the lockfile) already returns degrees, with a compass azimuth (0 = north, clockwise) and a refraction-corrected altitude, so no conversion is needed. suncalc 1.x used radians measured from south; don't apply its `+180°` conversion to 2.x.

Times are entered and shown in `Europe/Madrid`.

## Determinism (pipeline output)

- Keys appear in the order above, and `terraces` is sorted by `id`.
- Coordinates are rounded to 6 decimals.
- UTF-8, 2-space indent, each `horizon` array on a single line, trailing newline.

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

# ADR-0002: Terrace data sources

- Status: accepted (2026-11-22, recommended options)
- Date: 2026-11-22
- Issue: #2. Evidence and links: [research notes](../research/data-sources.md).

## Context

Each terrace record needs a venue (identity, name, kind) and the **position of the tables**, because the horizon is computed from there ([data contract](../data-contract.md), ADR-0001). What exists for `BADAJOZ_BBOX` on 2026-11-22:

| Source | Venues | Says "has a terrace" | Says where the tables are | Licence |
| --- | --- | --- | --- | --- |
| OSM | 157 | 2 (`outdoor_seating=yes`) | 2 bare `leisure=outdoor_seating` nodes | ODbL |
| Overture places `2026-11-18.0` | 859 (822 not closed) | no attribute | no | CDLA-Permissive-2.0, Apache-2.0, CC0 (by source) |
| Junta de Extremadura register | 1,100 in the municipality | no | no (addresses only) | CC BY 4.0 (verify) |
| Ayuntamiento velador authorizations | every authorized terrace | yes, authoritative | street and nearest number, m², 1:100 plan in the file | not published |
| Google Places `outdoorSeating` | n/a | yes | no | proprietary, terms forbid our use |

OSM and Overture barely overlap: about 61 of the 157 OSM venues match an Overture place, and about 754 Overture venues are missing from OSM. Neither source says where the tables are.

## Decision

1. **A terrace record exists only when OSM says `outdoor_seating=yes` or a curated row exists** (`pipeline/data/curated_terraces.csv`, #3, as already built in #16). Overture and Junta venues never become terraces on their own.
2. **The Ayuntamiento register seeds the curated rows.** The user files the Ley 19/2013 request in [`transparency-request.md`](../research/transparency-request.md). Curators match each authorization to a venue by address and name and add a row. The register gives the street segment, area and table count, not coordinates. It stays out of the repo and is not a pipeline input.
3. **OSM stays the venue base** (`osm:` ids). **Overture places is a to-do list for curators**: it shows venues OSM lacks. Under the recommended option A, nothing from Overture is copied into `terraces.json` (user decision 3 below).
4. **Positions are curated by people** (workflow below): placed on the PNOA orthophoto at a desk, then checked on site, which sets `verified`.
5. **Survey results go back to OSM**: `outdoor_seating=yes` on the venue and a `leisure=outdoor_seating` node or area at the tables, using StreetComplete's `AddSeating` quest (off by default), iD or JOSM. Only what was seen on site goes in: nothing copied from Overture, the Ayuntamiento list or Google. Later the pipeline can read `leisure=outdoor_seating` as a position source.
6. **Google Places is excluded entirely**, including as a hint for which venues to check: ToS §3.2.3(a) no scraping or storing, (b) no caching, (c) no creating content from Google Maps Content, (e) no Places content on a non-Google map; Service Specific Terms §14.2–14.3. Street View and Google imagery fall under (c), so they cannot be used to place points either.

## Licence and attribution duties

| Source | Licence | Duties for us |
| --- | --- | --- |
| OSM | ODbL 1.0 | `terraces.json` contains OSM names and positions, so it is a derivative database: publish it under ODbL and keep "© OpenStreetMap contributors" in the app and in `attribution`. |
| Curated CSV | Our own survey data | Publish it with `terraces.json` under ODbL. Never fill it from Google, Street View or (under option A) Overture. |
| Ayuntamiento register | Reuse under Ley 37/2007 | Cite "Ayuntamiento de Badajoz" and the data date, do not distort it, and do not imply endorsement. Publish business names only; no data on individual holders (we do not ask for it). Not importable into OSM without explicit permission. |
| PNOA orthophoto (desk placement) | CC BY 4.0, IGN | "PNOA cedido por © Instituto Geográfico Nacional". The same IGN credit is already required for LiDAR (#4). |
| Overture places (option B only) | CDLA-Permissive-2.0; Apache-2.0 (Foursquare); CC0 (AllThePlaces) | Ship the CDLA-Permissive-2.0 text with the data (§2.1). Skip Foursquare-only records, or ship the Apache-2.0 licence and NOTICE. Credit "Overture Maps Foundation". Under option A nothing is redistributed, so there are no duties. |
| Junta register | CC BY 4.0 (verify) | Credit the Junta de Extremadura if it is ever used. Not planned. |
| Google Places | Proprietary | Not used. |

## Terrace record fields

Contract v1 already covers every field issue #2 asks for, so **no contract change is needed**:

| Issue #2 asks for | Contract v1 | Note |
| --- | --- | --- |
| venue id | `id` (`osm:…`, `curated:<slug>`) | |
| name | `name` | |
| terrace point (the tables) | `terrace` | Centre of the table area. |
| sources | `sources` | Values: `osm`, `curated`, and `ayuntamiento` when the row has an `ayto_ref`. Add `overture` only under option B. |
| last verified date | `verified` | Set only by an on-site check, never by desk placement. |

The curated CSV from #3 (`id,osm_id,name,kind,terrace_lat,terrace_lon,verified,notes`) fits this. Proposed additions, which #3 would make:

- curation-only columns, not exported: `ayto_ref` (the row or file number in the Ayuntamiento register) and `overture_id` (GERS id, option B only);
- later, with a contract bump: `tables` and `area_m2` from the register, and a `covered` flag (ADR-0001 does not model awnings).

## Curation workflow

- **Who**: the maintainer owns `curated_terraces.csv`. Anyone can propose rows by PR, and a human reviews and merges each one. Agents may draft rows but never set `verified`.
- **How, per terrace**:
  1. Candidate: an authorization from the register, an OSM `outdoor_seating=yes` venue, or a venue spotted on site (Overture helps find them).
  2. Desk placement: put the point at the centre of the table area on the PNOA orthophoto. Leave `verified` empty.
  3. On-site check: stand among the tables and confirm or move the point (correct GPS drift in narrow streets against the orthophoto). Compare with the authorization plan the venue must display (ordinance art. 24.2), then set `verified`.
  4. Map it in OSM (decision 5).
  5. Open a PR with one batch per street or area. Checks to add in the pipeline (#3 follow-up): the terrace is inside the bbox and within 50 m of its venue, no two terraces share a position, and rows with `verified` older than 2 years trigger a warning.
- **How often**:
  - Every January to March: request the updated register (authorizations run for the calendar year and renew automatically, art. 8) and compare it with the CSV.
  - Every spring, before terrace season: check on site the rows that are unverified or older than 2 years.
  - User reports, once #8 adds a backend.

## Consequences

- Coverage grows as fast as people curate. The register speeds up desk work, but every position still needs a human, and the app starts with few terraces.
- The dataset holds no proprietary data, stays redistributable under ODbL, and improves OSM for everyone.
- A terrace is a single point. Long terraces, or ones split across a street, get one representative point (user decision 6 below).
- If the Ayuntamiento refuses or does not answer, fall back to surveying street by street. The CTBG complaint route stays open.

## Alternatives considered

- **Overture as an automatic venue source**: about 860 venues with no terrace signal would all show up as terraces, which is wrong for most of them.
- **Google Places `outdoorSeating`**: forbidden by its terms (Decision, item 6).
- **Municipal open data, as in Paris, Madrid or Barcelona**: Badajoz does not publish it, hence the request.
- **StreetComplete alone**: it only reaches venues already in OSM, the quest is off by default, and it records no position.

## Decisions left to the user

1. Approve this combination of sources, or change it.
2. File the transparency request. It needs your identity. The deadline is one month (art. 20.1); a refusal or no answer can be taken to the CTBG.
3. Overture: **A** (recommended), a to-do list only; or **B**, take names and venue positions for venues not in OSM, which means shipping the CDLA text, adding the attribution line and adding an `overture_id` column.
4. OSM write-back: do you (or contributors) push surveyed `outdoor_seating` and `leisure=outdoor_seating` to OSM under your own accounts?
5. Can desk-placed, unverified positions ship? (Recommended: yes, with `verified: null`, and the app marks them.)
6. A venue with two separate terrace areas: one record at the larger area (recommended for v1), or one record per area, which needs a new id scheme.
7. Add the `ayto_ref` (and, under B, `overture_id`) columns to the CSV in #3.
8. State in the README that `terraces.json` is ODbL (README is out of scope for this PR).

## Resolution (2026-11-22)

Accepted as proposed, with the recommended option wherever there was one:

1. The combination of sources above is approved.
2. The transparency request is the user's to file. **Pending.**
3. Overture: **option A**, a to-do list for curators only. Nothing from Overture is copied into `terraces.json`.
4. OSM write-back (decision 5): survey results go to OSM under each contributor's own account.
5. Desk-placed, unverified positions ship with `verified: null`, and the app marks them (#21).
6. A venue with two terrace areas gets one record, at the larger area, for v1.
7. The `ayto_ref` column is added to the curated CSV (#22). Option A means no `overture_id` column.
8. The README states that `terraces.json` is ODbL.

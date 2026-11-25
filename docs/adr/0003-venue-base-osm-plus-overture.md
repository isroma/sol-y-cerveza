# ADR-0003: Venue base is OSM plus Overture

- Status: accepted (2026-11-24)
- Date: 2026-11-24
- Supersedes: decision 3 of [ADR-0002](0002-terrace-data-sources.md) ("Overture is a to-do list only", option A)

## Context

The user asked (2026-11-23) for the venue list to cover the majority of Badajoz's bars and restaurants, from open data, and approved implementing the best sources overnight when licences are clearly fine.

Research (2026-11-23, see `docs/research/data-sources.md`) measured the bbox:
- OSM has 157 venues.
- Overture Maps 2026-11-18.0 has about 860 bars, cafés and restaurants.
- Foursquare's open places are mostly stale, and AllThePlaces adds only chains.

No open dataset or API we may use says which venues have a terrace. Every API that has an outdoor-seating attribute (Google, Foursquare, Yelp, TripAdvisor) forbids storing it or building a database from it.

## Decision

1. The pipeline lists **OSM venues plus Overture places** (option B of ADR-0002):
   - Overture is filtered to bars, pubs, cafés, restaurants and beer gardens that are not permanently closed and have `confidence ≥ 0.6`.
   - Duplicates of OSM venues are dropped by distance and name similarity, so OSM ids win.
   - Ids are `overture:<GERS id>`, and `sources` is `["overture"]`.
2. Overture records with a **Foursquare** source are left out. Apache-2.0 would oblige us to ship its NOTICE file, and there are only a handful.
3. The rest is CDLA-Permissive-2.0 (Meta, Microsoft, BrightQuery) or CC0. CDLA only requires shipping its text with the data, so `web/public/data/licenses/CDLA-Permissive-2.0.txt` ships next to `terraces.json`, and the attribution line points to it. Our output stays ODbL because it contains OSM data.
4. **Terraces still come only from OSM `outdoor_seating=yes` and curated rows** (ADR-0002 decision 1). Overture venues show as unconfirmed terraces ("terraza sin confirmar" in the app) until a curator adds their terrace.

## Consequences

- 613 venues (2026-11-24) instead of 136, and the map and list show most of the city's bars.
- Overture names and positions are less reliable than OSM's: some places have closed, some are misplaced. The confidence threshold and the OSM-first merge limit this. Curators can correct venues by contributing to OSM, which then wins the merge.
- Data refreshes now also depend on Overture's public S3 bucket and the pinned `RELEASE` in `solycerveza.overture`. Bump the release deliberately and review the diff.

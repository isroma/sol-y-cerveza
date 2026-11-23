# Review and roadmap (2026-11-23)

A review of the whole project after the phone layout work, and what to do next. Issues are the source of truth for work in progress; this page is the map.

## Where the project stands

- **Data:** 700 named venues, 74 with a terrace position, none verified on site, no prices yet. The sun/shade answer is only as good as the terrace pin: a pin a few metres off (against a wall, under a crown) reads as shade all day.
- **App:** static client, no backend for the core answer. Phone and desktop share one map; the layout differs on purpose (design standards §5).
- **Engineering:** strict TypeScript and mypy, zod at every data boundary, pinned GitHub Actions, Dependabot, squash-only protected `main` with one required aggregate check, ADRs for every data decision. This is in good shape; keep it.

## What the review found

| Area               | Finding                                                                                                                    | Action                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reach              | No link opens a venue or a time. No link preview.                                                                          | Share links, share button, Open Graph image                 |
| First load         | One 1.4 MB script before anything paints.                                                                                  | Load the map chunk lazily; web manifest                     |
| Regressions        | Unit tests mock the map, so layout, pins, card and shadows are only checked by hand.                                       | Browser smoke tests on a real map in CI                     |
| Data upkeep        | A pin's sun can't be seen until the next build and deploy.                                                                 | Sun preview and a "needs a look" list in the admin          |
| Honesty            | Deciduous trees shade all year (LiDAR flown with leaves on).                                                               | Seasonal trees (below)                                      |
| Shadows on the map | Drawn from basemap building heights (×1.4), while the answer comes from LiDAR, so the picture and the answer can disagree. | Accept for now; say so in "Sobre los datos" if users notice |

## Decided: not doing

- **Other days.** The app shows today only: no date or day picker.
- **Weather.** No clouds or forecasts: "sun" means the sun is up and unobstructed.

Both are owner decisions (2026-11-23), recorded in `CLAUDE.md`.

## Parked: not now

Not rejected: they may come back later, but don't propose or start them unless the owner asks (owner, 2026-11-23, recorded in `CLAUDE.md`).

- **Accessibility pass.** Keyboard path through the map, focus management in the phone menu, contrast at night.
- **More cities.** The pipeline is Badajoz-specific in `geo.py` and the LiDAR sheets.
- **Native mobile apps.** Paused; the web app is installable.

## Next, in order

Prices come without scraping third-party platforms (their terms forbid it, and the data contract forbids storing it).

1. **Photo to price.** Photo of the price board → the admin pre-fills caña and tercios, the owner confirms.
2. **Admin on a phone.** Use it on site: mark terrace / no terrace, drag the pin, set `verified`. Send batches to OSM with `solycerveza.osm_export`.
3. **Prices from venue websites.** Read them from the sites already fetched for terrace evidence (ADR-0004) into the admin's suggestion queue.
4. **Visitor suggestions** (ADR-0005). Needs the owner's Cloudflare account for `PRICES_API` and Turnstile.
5. **Seasonal trees.** ADR first. Classify vegetation in the LiDAR point cloud and treat deciduous crowns as open from December to March; check against a few known terraces.
6. **Offline caching.** A service worker for the app and its data.

## How to iterate

- One issue, one small PR, auto-merge on green: keep it.
- Every UI change is checked at desktop and phone width (CLAUDE.md), and by the smoke tests once they land.
- Product choices that change what the app claims (trees, price trust rules) get an ADR first.
- Measure before optimising: record bundle sizes in the PR that changes them.

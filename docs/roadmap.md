# Review and roadmap (2026-11-23)

A review of the whole project after the phone layout work, and what to do next. Issues are the source of truth for work in progress; this page is the map.

## Where the project stands

- **Data:** 700 named venues, 74 with a terrace position, none verified on site, no prices yet. The sun/shade answer is only as good as the terrace pin: a pin a few metres off (against a wall, under a crown) reads as shade all day.
- **App:** static client, no backend for the core answer. Phone and desktop share one map; the layout differs on purpose (design standards §5).
- **Engineering:** strict TypeScript and mypy, zod at every data boundary, pinned GitHub Actions, Dependabot, squash-only protected `main` with one required aggregate check, ADRs for every data decision. This is in good shape; keep it.

## What the review found

| Area               | Finding                                                                                                                    | Action                                                      |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Reach              | No link opens a venue or a time, and the day can't be chosen, although "any date" is the promise. No link preview.         | Share links, day picker, share button, Open Graph image     |
| First load         | One 1.4 MB script before anything paints.                                                                                  | Load the map chunk lazily; web manifest                     |
| Regressions        | Unit tests mock the map, so layout, pins, card and shadows are only checked by hand.                                       | Browser smoke tests on a real map in CI                     |
| Data upkeep        | A pin's sun can't be seen until the next build and deploy.                                                                 | Sun preview and a "needs a look" list in the admin          |
| Honesty            | "Sun" ignores clouds. Deciduous trees shade all year (LiDAR flown with leaves on).                                         | Cloud cover; seasonal trees (below)                         |
| Shadows on the map | Drawn from basemap building heights (×1.4), while the answer comes from LiDAR, so the picture and the answer can disagree. | Accept for now; say so in "Sobre los datos" if users notice |

## Next, in order

1. **Prices.** Seed them without scraping third-party platforms (their terms forbid it, and the data contract forbids storing it):
   - read prices from venue websites already fetched for terrace evidence (ADR-0004) into the admin's suggestion queue;
   - photo of the price board → the admin pre-fills caña and tercios, the owner confirms;
   - visitor suggestions (ADR-0005) once `PRICES_API` and Turnstile are configured.
2. **Verified terraces.** Use the admin on a phone, on site: mark terrace / no terrace, drag the pin, set `verified`. Send batches to OSM with `solycerveza.osm_export`.
3. **Clouds.** Hourly cloud cover for Badajoz (AEMET open data or Open-Meteo, both need attribution) shown next to the sun answer: "Sol, pero nublado". It is the first third-party request from visitors' browsers, so it needs an ADR (privacy, attribution, failure mode: say nothing).
4. **Seasonal trees.** Classify vegetation in the LiDAR point cloud and treat deciduous crowns as open from December to March. Needs the classified tiles and a check against a few known terraces.
5. **Accessibility pass.** Keyboard path through the map (pins are buttons already), focus management in the phone menu, contrast at night, reduced motion for the card.
6. **Offline and install.** A service worker only once deploys slow down: stale caches are worse than no cache while the app changes daily.
7. **More cities.** The city pill already says "Más ciudades, próximamente". The pipeline is Badajoz-specific in `geo.py` and the LiDAR sheets; generalise only when a second city is real.
8. **Mobile apps.** Still paused. The web app is installable; revisit when prices and verified terraces give people a reason to return.

## How to iterate

- One issue, one small PR, auto-merge on green: keep it.
- Every UI change is checked at desktop and phone width (CLAUDE.md), and by the smoke tests once they land.
- Product choices that change what the app claims (clouds, trees, price trust rules) get an ADR first.
- Measure before optimising: record bundle sizes in the PR that changes them.

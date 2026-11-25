# Roadmap

What is done, what is left, and what is settled. Issues are the source of truth for work in progress; this page is the map. Last updated 2026-11-25.

## Where the project stands

From `web/public/data/terraces.json` (generated 2026-11-23):

- **Venues:** 695 named venues: 452 from Overture, 153 from OSM, 90 from the Junta register (each has one base source).
- **Terraces:** 88 with a terrace position, all with a horizon. 41 come from curated rows and 52 from pins placed in the admin (some are both); none is verified on site.
- **Seasonal trees:** 0 of the 88 have a `horizon_winter` yet (see Open).
- **Prices:** none in the data yet (`pipeline/data/venue_prices.csv` holds only its header). Visitor and owner prices live in the API's D1 database and load at runtime.

The sun/shade answer is only as good as the terrace pin: a pin a few metres off (against a wall, under a crown) reads as shade all day.

## Done

- **Share links and link previews:** a URL opens a venue at a time, with an Open Graph image (#165, #167). The share button is off the card since the card back (#234, issue #233); `ShareButton` in `web/src/map/PinCard.tsx` is kept to bring it back.
- **Lazy map and web manifest:** the map chunk loads after first paint (#167).
- **Browser smoke tests in CI:** Playwright on a real map, phone and desktop (#166), offline project (#188), jobs per project group in parallel (#241).
- **Sun preview and "Needs a look" in the admin** (#168), with a Looks right (Y) button (#205).
- **Photo to price** in the admin (#178).
- **Price candidates from venue websites** (#179, admin #180; [ADR-0006](adr/0006-price-candidates-from-venue-websites.md)).
- **Visitor price suggestions** (API #98, web #103; guardrails #197; [ADR-0005](adr/0005-price-suggestions.md)).
- **Owner mode:** the owner saves prices from their phone on the public site, with photo reading (#192, #195).
- **Admin on a phone:** built (#181), then removed in favour of owner mode (#199).
- **Offline caching:** a network-first service worker (#188; [ADR-0011](adr/0011-network-first-service-worker.md)).
- **Seasonal trees, code:** leaf-off horizons from Sentinel-2 for 1 December to 15 March (ADR #182, pipeline #183; [ADR-0007](adr/0007-seasonal-trees.md)). The earlier idea of classifying the LiDAR point cloud is superseded by Sentinel-2 (ADR-0007, "What the data can tell us").
- **Venue reports from visitors:** moved, closed, missing (API #207, admin #208, web #213), terrace yes/no and pin (API #217, admin #218; [ADR-0009](adr/0009-terrace-reports.md)).
- **Machine venue proposals:** proposers and trial (#214), admin review queue with proposals (#216; [ADR-0008](adr/0008-machine-venue-proposals.md)).
- **Card back for suggesting a change,** sending everything in one request behind one bot check (#234, #237, #240, API #243, web #245, #246, #250; [ADR-0010](adr/0010-one-change-request.md)).
- **Map shadows:** still drawn from basemap building heights (×1.4), not LiDAR, accepted for now; their rendering was reworked for speed (#244, #251, #252).
- **OSM write-back file** for JOSM (#141) and the **probe CLI** behind the sun preview (#162).

## Open

- **Visitor terrace reports in the app:** "¿Tiene terraza?" and placing the tables from the card (#210, open PR #219). The API and admin side are built.
- **Proposals trial:** `python -m solycerveza.proposals --evaluate` has not been run; it needs the owner's machine (caches, network, API key). No proposer kind has a measured threshold yet ([ADR-0008](adr/0008-machine-venue-proposals.md)).
- **Seasonal trees, data:** the owner runs `solycerveza.leafoff` and publishes a rebuilt `terraces.json` ([pipeline guide, "Seasonal trees"](pipeline.md#seasonal-trees) has the checks).
- **Owner-price import into `venue_prices.csv`:** described in ADR-0005, never built (#263).
- **Owner photo reading on Workers AI** instead of the Claude API (#223, open PR #230).
- **PNOA credit for admin review pins**, not only curated rows (`attribution_lines` in `pipeline/src/solycerveza/build.py`, #264).
- **Caña price on the map badge** and in the overview highlights (`web/src/map/pins.ts`, `web/src/map/highlights.ts`, #265; prices research #8).
- **Visitor sun reports (discovery):** "Aquí da el sol ahora" on the card back, stamped by the server, reviewed in the admin into a pin move or a horizon correction; design open (#364).
- **Human actions** to find more terraces: the Ayuntamiento request, accounts, 2 m LiDAR downloads (#46).

## Decided and parked

The settled decisions (today only, no weather) and the parked ones (accessibility pass, more cities, native mobile apps) are in [CLAUDE.md](../CLAUDE.md), "Product decisions". Don't propose or start them unless the owner asks.

## How to iterate

- One issue, one small PR, auto-merge on green: keep it.
- Every UI change is checked at desktop and phone width (CLAUDE.md), and by the smoke tests.
- Product choices that change what the app claims (trees, price trust rules) get an ADR first.
- Measure before optimising: record bundle sizes in the PR that changes them.

## History

### Review of 2026-11-23

A review of the whole project after the phone layout work. At the time: 700 named venues, 74 with a terrace position, no prices. Its findings, with what became of each:

| Area               | Finding                                                                                                                    | Action                                                      | Outcome |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- |
| Reach              | No link opens a venue or a time. No link preview.                                                                          | Share links, share button, Open Graph image                 | Done (#165, #167); share button hidden since #234 |
| First load         | One 1.4 MB script before anything paints.                                                                                  | Load the map chunk lazily; web manifest                     | Done (#167) |
| Regressions        | Unit tests mock the map, so layout, pins, card and shadows are only checked by hand.                                       | Browser smoke tests on a real map in CI                     | Done (#166) |
| Data upkeep        | A pin's sun can't be seen until the next build and deploy.                                                                 | Sun preview and a "needs a look" list in the admin          | Done (#168) |
| Honesty            | Deciduous trees shade all year (LiDAR flown with leaves on).                                                               | Seasonal trees                                              | Code done (#183); data not built yet |
| Shadows on the map | Drawn from basemap building heights (×1.4), while the answer comes from LiDAR, so the picture and the answer can disagree. | Accept for now; say so in "Sobre los datos" if users notice | Still accepted; rendering reworked (#244, #251, #252) |

Its "Next, in order" list was: photo to price, admin on a phone, prices from venue websites, visitor suggestions, seasonal trees, offline caching. All are in Done above.

# Sol y Cerveza ☀️🍺

Which bar and restaurant terraces in Badajoz get sun or shade today, at any time of day, and what a beer costs there.

- **Web:** <https://isroma.github.io/sol-y-cerveza/>
- **iOS / Android:** Capacitor shells exist, paused until the web version is polished ([mobile](docs/mobile.md))

## How it works

```
pipeline/ (offline, Python)                         web/ (static, TypeScript)
venues + terrace positions ─┐
LiDAR surface model ────────┴─► horizon profile ──► web/public/data/ ──► sun position today at the
                                 per terrace (360°)   terraces.json       chosen time vs. horizon → sun / shade
```

Shade is precomputed as each terrace's horizon: how high the surrounding buildings and trees rise in every direction. The app then only needs the sun's position, which it computes on the device. The map draws the buildings and tree crowns from the same LiDAR and casts their shadows on the GPU for the chosen time ([pipeline](docs/pipeline.md#lidar-buildings)). Beer prices and visitors' suggestions and venue reports go through a small API (`api/`, a Cloudflare Worker). Details: [ADR-0001](docs/adr/0001-architecture.md) and the [data contract](docs/data-contract.md).

## Status

The sun/shade map, the phone layout, the admin, beer prices (the owner's and visitors' suggestions), visitor venue reports, the seasonal-tree code and offline use are built. What is left and why: [review and roadmap](docs/roadmap.md).

## Quick start

You need Node 26 and [uv](https://docs.astral.sh/uv/).

```bash
cp web/.env.example web/.env.local     # optional: API, Turnstile and admin keys (see the comments in it)
cd web && npm ci && npm run dev        # web app on http://localhost:5173
cd pipeline && uv sync && uv run pytest
```

To try prices and reports against a local API (`api/README.md`, "Local development"), run the Worker and point the app at it:

```bash
cd api && cp .dev.vars.example .dev.vars && npm ci && npm run migrate:local
npm run dev                            # API on http://localhost:8787
```

Then set `VITE_PRICES_API=http://localhost:8787` in `web/.env.local` (the example's Turnstile site key always passes on localhost) and restart `npm run dev` in `web/`. For the admin's Suggestions and Reports queues set `PRICES_ADMIN_TOKEN` to the `ADMIN_TOKEN` in `api/.dev.vars`; for owner mode, open the app at `#owner=` followed by its `OWNER_TOKEN`.

Browser smoke tests (Playwright, `web/e2e/`) drive the real app and map in Chromium, with a stubbed basemap and a small fixed data set, so they need no network:

```bash
cd web && npx playwright install --with-deps chromium   # once
npm run e2e                                             # every Playwright project
```

The five projects and how to run only some (`E2E_PROJECTS`) are in [operations](docs/operations.md#ci). To rebuild the data, see the [pipeline guide](docs/pipeline.md); to curate venues, terraces and prices, the [admin guide](docs/admin.md).

## Contributing

Every change goes through a PR with green CI. [CLAUDE.md](CLAUDE.md) has the workflow, the quality gates and the conventions.

## Documentation

- [Admin guide](docs/admin.md): the dev-only admin, deciding venues, fixing a terrace, prices, reports, machine proposals, Publish.
- [Pipeline guide](docs/pipeline.md): building `terraces.json`, the LiDAR rasters, seasonal trees, website price candidates, machine proposals, OSM write-back, the files in `pipeline/data/`.
- [Operations](docs/operations.md): deploys, variables and secrets, the service worker and its kill switch, CI, brand images.
- [API](api/README.md): endpoints, spam and bot guardrails, local development, deploys.
- [Design standards](docs/design/README.md): brand, colours, typography, components, copy.
- [Data contract](docs/data-contract.md): the format of `terraces.json`.
- [Architecture decisions](docs/adr/) and [research notes](docs/research/) (data sources, LiDAR, orthophotos).
- [Mobile](docs/mobile.md): the paused Capacitor shells.

## Design

Brand, colours, typography, components, copy and templates: [design standards](docs/design/README.md).

![Sol y Cerveza palette](docs/design/palette.svg)

## Data and attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Basemap tiles by [OpenFreeMap](https://openfreemap.org). The service worker keeps a bounded copy of the basemap files a visitor has already loaded in that visitor's browser (at most 600 files, 30 days), so areas already seen work offline; the project does not store or redistribute them.
- More venues from [Overture Maps](https://overturemaps.org) (CDLA-Permissive-2.0, [licence text](web/public/data/licenses/CDLA-Permissive-2.0.txt)); see [ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md).
- Venues from the Junta de Extremadura's restaurant register (CC BY 4.0), geocoded with CartoCiudad (CC BY 4.0 ign.es); see [ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md).
- Terrace positions placed on the PNOA orthophoto © IGN (CC-BY 4.0).
- Surface and terrain models (PNOA-LiDAR 2nd coverage, flown 2018–19, 2 m): `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` and `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` (IGN/CNIG); [details](docs/research/lidar.md).
- Deciduous trees for the winter horizons (when built): `Contiene datos modificados de Copernicus Sentinel (2025)` (Sentinel-2 L2A, Copernicus open licence); [ADR-0007](docs/adr/0007-seasonal-trees.md).

## License

Code is MIT. `web/public/data/terraces.json` and the map's `buildings.json` (OSM outlines at LiDAR heights) contain OpenStreetMap data and are released under the [ODbL](https://opendatacommons.org/licenses/odbl/); its other sources are credited inside the file ([data sources](docs/research/data-sources.md), [ADR-0002](docs/adr/0002-terrace-data-sources.md)).

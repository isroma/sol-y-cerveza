# Sol y Cerveza ☀️🍺

Which bar and restaurant terraces in Badajoz get sun or shade today, at any time of day.

- **Web:** <https://isroma.github.io/sol-y-cerveza/>
- **iOS / Android:** Capacitor shells exist, paused until the web version is polished

## How it works

```
pipeline/ (offline, Python)                         web/ (static, TypeScript)
venues + terrace positions ─┐
LiDAR surface model ────────┴─► horizon profile ──► web/public/data/ ──► sun position for the chosen
                                 per terrace (360°)   terraces.json       date/time vs. horizon → sun / shade
```

Shade is precomputed as each terrace's horizon: how high the surrounding buildings and trees rise in every direction. The app then only needs the sun's position, which it computes on the device. Details: [ADR-0001](docs/adr/0001-architecture.md) and the [data contract](docs/data-contract.md).

## Roadmap

The sun/shade map, the phone layout and the admin are live. What comes next (prices, verified terraces, seasonal trees) and why: [review and roadmap](docs/roadmap.md).

## Design

Brand, colours, typography, components, copy and templates: [design standards](docs/design/README.md).

![Sol y Cerveza palette](docs/design/palette.svg)

## Development

You need Node 26 and [uv](https://docs.astral.sh/uv/).

```bash
cd web && npm ci && npm run dev        # web app on http://localhost:5173
cd pipeline && uv sync && uv run pytest
```

Browser smoke tests (Playwright, `web/e2e/`) drive the real app and map in Chromium, with a stubbed basemap and a small fixed data set, so they need no network. Install the browser once, then run them:

```bash
cd web && npx playwright install --with-deps chromium
npm run e2e                            # phone and desktop on the dev server, plus the offline tests
```

`npm run e2e` also runs `e2e/offline.spec.ts` (Playwright project `offline`): the service worker against production builds served under `/sol-y-cerveza/` by `web/scripts/sw-test-server.mjs`, which builds them first and can switch between two deploys and the kill switch.

### Offline and the service worker

The built site registers `sw.js` (source `web/sw/sw.ts`, emitted by the `serviceWorker` plugin in `web/vite.config.ts`). It is never registered in dev (`npm run dev`, `npm run admin`), in the admin or inside the Capacitor apps (`web/src/registerServiceWorker.ts`).

| Request                                                  | Strategy                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/*-<hash>.*`                                      | Precached at install, cache-first. One cache per build (`syc-app-<build>`); the previous build's is kept so pages still open on it keep working. |
| The page, `data/terraces.json`, icons, other files       | Network-first, past the HTTP cache (revalidated), 3 s timeout; the cache only when offline, slow or on a 5xx. A late response still updates it. |
| OpenFreeMap style and TileJSON                            | Network-first with the same timeout (they name the tile version to load).                                                                     |
| OpenFreeMap tiles, glyphs, sprites                        | Stale-while-revalidate, at most 600 entries and 30 days; CORS responses only, never opaque ones.                                              |
| Prices API `GET /v1/prices`                               | Network-first. POSTs (suggestions) and everything else are not touched.                                                                       |

A new worker takes over at once (`skipWaiting`, `clients.claim`) but never reloads an open page; its next load is the new version. If a page asks for a map chunk that a deploy removed and no cache has, `LazyMapView` reloads once (guarded by `sessionStorage`, no loops) and then shows "No se pudo cargar el mapa".

**Kill switch.** If the worker misbehaves, set the repository variable `SW_KILL_SWITCH` to `1` (Settings → Secrets and variables → Actions → Variables) and run the **Deploy web to GitHub Pages** workflow (or push anything to `main`). That build ships `web/sw/kill-switch.ts` as `sw.js`: browsers check `sw.js` on every visit, even when the app's own code is broken, and it deletes the site's caches and unregisters itself; the page also unregisters and clears them. Pages are not reloaded under the user. Delete the variable (or set it to `0`) and deploy again to turn caching back on. Without CI: `cd web && VITE_SW_KILL_SWITCH=1 npm run build` and publish `dist/`.

To rebuild the data (`web/public/data/terraces.json`) from `pipeline/`:

```bash
uv run python -m solycerveza.obstacles --source wcs   # surface + terrain rasters, once (see docs/research/lidar.md for the 2 m data)
uv run python -m solycerveza.build                     # venues + curated list + horizons -> terraces.json
```

The app icons in the web manifest (`web/public/icon-*.png`) and the link preview image (`web/public/og.png`) come from `web/public/favicon.svg`: regenerate them with `cd web && node scripts/brand-images.mjs` (needs Playwright's Chromium).

### Fixing a terrace

`cd web && npm run admin` opens the dev-only admin. It needs the LiDAR rasters in `pipeline/.cache/` (from `solycerveza.obstacles` above) for the sun preview; everything else works without them.

1. Pick **Needs a look**: terraces whose current horizon gets no sun today, on 21 Jun or on 21 Dec, or is above 60° over most of the southern half. Usually the pin is against a wall, under a tree crown or on a roof.
2. Click one, press **T** and click (or drag the pin to) where the tables stand. The panel's **Sun at the terrace pin** updates as you go: today's hours of sun, a 24 h strip (amber sun, grey shade, light night) and the **height above ground** at the pin.
3. Read it:
   - **No sun** while the tables do get sun: the pin is in the shade of something the tables are not, typically tight against a façade or under a crown. Move it a few metres onto open ground, towards the middle of the tables.
   - **Height above ground** is the surface model minus the terrain under the pin. On the street it reads about 0 m. Above 2 m (the build's warning threshold) the pin sits on a roof, an awning or a tree crown, and its horizon is meaningless: move it to the pavement or square below.
4. **Publish** when done. The list is computed from the published `terraces.json`, so a fixed terrace leaves it after the next build ("pin moved since the build" until then).

Every change goes through a PR with green CI. [CLAUDE.md](CLAUDE.md) has the workflow, the quality gates and the conventions.

## Data and attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Basemap tiles by [OpenFreeMap](https://openfreemap.org). The service worker keeps a bounded copy of the basemap files a visitor has already loaded in that visitor's browser (at most 600 files, 30 days), so areas already seen work offline; the project does not store or redistribute them.
- More venues from [Overture Maps](https://overturemaps.org) (CDLA-Permissive-2.0, [licence text](web/public/data/licenses/CDLA-Permissive-2.0.txt)); see [ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md).
- Venues from the Junta de Extremadura's restaurant register (CC BY 4.0), geocoded with CartoCiudad (CC BY 4.0 ign.es); see [ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md).
- Terrace positions placed on the PNOA orthophoto © IGN (CC-BY 4.0).
- Surface and terrain models (PNOA-LiDAR 2nd coverage, flown 2018–19, 2 m): `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` and `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` (IGN/CNIG); [details](docs/research/lidar.md).

## License

Code is MIT. `web/public/data/terraces.json` contains OpenStreetMap data and is released under the [ODbL](https://opendatacommons.org/licenses/odbl/); its other sources are credited inside the file ([data sources](docs/research/data-sources.md), [ADR-0002](docs/adr/0002-terrace-data-sources.md)).

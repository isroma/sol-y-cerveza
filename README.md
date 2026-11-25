# Sol y Cerveza ☀️🍺

Which bar and restaurant terraces in Badajoz get sun or shade today, at any time of day.

- **Web:** <https://isroma.github.io/sol-y-cerveza/>
- **iOS / Android:** Capacitor shells exist, paused until the web version is polished

## How it works

```
pipeline/ (offline, Python)                         web/ (static, TypeScript)
venues + terrace positions ─┐
LiDAR surface model ────────┴─► horizon profile ──► web/public/data/ ──► sun position today at the
                                 per terrace (360°)   terraces.json       chosen time vs. horizon → sun / shade
```

Shade is precomputed as each terrace's horizon: how high the surrounding buildings and trees rise in every direction. The app then only needs the sun's position, which it computes on the device. Details: [ADR-0001](docs/adr/0001-architecture.md) and the [data contract](docs/data-contract.md).

## Roadmap

The sun/shade map, the phone layout, the admin, beer prices (the owner's and visitors' suggestions), visitor venue reports, the seasonal-tree code and offline use are built. What is left and why: [review and roadmap](docs/roadmap.md).

## Design

Brand, colours, typography, components, copy and templates: [design standards](docs/design/README.md).

![Sol y Cerveza palette](docs/design/palette.svg)

## Development

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

Browser smoke tests (Playwright, `web/e2e/`) drive the real app and map in Chromium, with a stubbed basemap and a small fixed data set, so they need no network. Install the browser once, then run them:

```bash
cd web && npx playwright install --with-deps chromium
npm run e2e                            # every Playwright project
```

There are five projects (`web/playwright.config.ts`): `phone` and `desktop` on the dev server, `reports-phone` and `reports-desktop` on a dev server with a stubbed prices API and Turnstile key, and `offline`. Set `E2E_PROJECTS` to a comma-separated list (e.g. `E2E_PROJECTS=phone,reports-phone npm run e2e`) to run only those. `npm run e2e` also runs `e2e/offline.spec.ts` (Playwright project `offline`): the service worker against production builds served under `/sol-y-cerveza/` by `web/scripts/sw-test-server.mjs`, which builds them first and can switch between two deploys and the kill switch.

### Offline and the service worker

The built site registers `sw.js` (source `web/sw/sw.ts`, emitted by the `serviceWorker` plugin in `web/vite.config.ts`). It is never registered in dev (`npm run dev`, `npm run admin`), in the admin or inside the Capacitor apps (`web/src/registerServiceWorker.ts`).

| Request                                                  | Strategy                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets/*-<hash>.*`                                      | Precached at install, cache-first. One cache per build (`syc-app-<build>`); the previous build's is kept so pages still open on it keep working. |
| The page, `data/terraces.json`, icons, other files       | Network-first, past the HTTP cache (revalidated), 3 s timeout; the cache only when offline, slow or on a 5xx. A late response still updates it. |
| OpenFreeMap style and TileJSON                            | Network-first with the same timeout (they name the tile version to load).                                                                     |
| OpenFreeMap tiles, glyphs, sprites                        | Stale-while-revalidate, at most 600 entries and 30 days; CORS responses only, never opaque ones.                                              |
| Prices API `GET /v1/prices`                               | Network-first. Writes (`POST /v1/changes`, `POST /v1/reports`, owner mode's `/v1/owner/*`) and everything else are not touched.               |

A new worker takes over at once (`skipWaiting`, `clients.claim`) but never reloads an open page; its next load is the new version. If a page asks for a map chunk that a deploy removed and no cache has, `LazyMapView` reloads once (guarded by `sessionStorage`, no loops) and then shows "No se pudo cargar el mapa".

**Kill switch.** If the worker misbehaves, set the repository variable `SW_KILL_SWITCH` to `1` (Settings → Secrets and variables → Actions → Variables) and run the **Deploy web to GitHub Pages** workflow on `main` (Actions → Run workflow). A manual run deploys `main` at once, without waiting for CI; a merge to `main` also redeploys, but only once CI passes on it (the `deploy-pages` job in `ci.yml`, after `ci-ok`). That build ships `web/sw/kill-switch.ts` as `sw.js`: browsers check `sw.js` on every visit, even when the app's own code is broken, and it deletes the site's caches and unregisters itself; the page also unregisters and clears them. Pages are not reloaded under the user. Delete the variable (or set it to `0`) and deploy again to turn caching back on. Without CI: `cd web && VITE_SW_KILL_SWITCH=1 npm run build` and publish `dist/`.

To rebuild the data (`web/public/data/terraces.json`) from `pipeline/`:

```bash
cd pipeline
uv run python -m solycerveza.obstacles                 # surface + terrain rasters, once, from the 2 m MDS02/MDT02 sheets
                                                       # downloaded by hand (docs/research/lidar.md; the command says how)
# uv run python -m solycerveza.obstacles --source wcs  # fallback: automated 5 m MDS05/MDT05 (flown 2009–10); changes the attribution
uv run python -m solycerveza.leafoff                   # optional: leaf-off surface model for winter (ADR-0007)
uv run python -m solycerveza.build                     # venues + curated list + horizons -> terraces.json
```

### Seasonal trees

From 1 December to 15 March the app uses each terrace's `horizon_winter`: the horizon with deciduous tree crowns removed ([ADR-0007](docs/adr/0007-seasonal-trees.md)). `solycerveza.leafoff` builds it from the DSM, the DTM, OSM building footprints (Overpass) and a Sentinel-2 NDVI composite (public COGs on AWS, no account). It writes `pipeline/.cache/badajoz_dsm_leafoff.tif`. Without that file the build writes no winter horizons and the app behaves as before.

To check a rebuild:

1. `git diff --stat web/public/data/terraces.json`: count the terraces that gained a `horizon_winter` (the build also logs it). In the city centre, expect tens, not hundreds.
2. Open `pipeline/.cache/badajoz_dsm_leafoff.tif` and `badajoz_dsm.tif` in QGIS and look at their difference: only tree crowns should be lowered, never a roof, the city walls or the Alcazaba.
3. Pick 3–5 terraces you know: some under plane trees or mulberries (they should gain a winter horizon), and some under orange trees, palms or pines (they should not). Run the app with the clock in January (or the admin probe) and compare.
4. If evergreens come out as bare, raise `WINTER_DROP_MIN_NDVI` in `pipeline/src/solycerveza/leafoff.py`. If plane-tree squares are missed, lower it, or `SUMMER_MIN_NDVI`. Say what you changed in the PR.

The app icons in the web manifest (`web/public/icon-*.png`) and the link preview image (`web/public/og.png`) come from `web/public/favicon.svg`: regenerate them with `cd web && node scripts/brand-images.mjs` (needs Playwright's Chromium).

### The admin

`cd web && npm run admin` opens the dev-only admin. It needs the LiDAR rasters in `pipeline/.cache/` (from `solycerveza.obstacles` above) for the sun preview; everything else works without them.

Besides terraces, its **Website prices** button lists the beer prices `python -m solycerveza.price_candidates` found on venues' own websites ([ADR-0006](docs/adr/0006-price-candidates-from-venue-websites.md)), each with the text it was read from and a link to the page: check it, then **Accept** (it becomes the venue's price, shipped with the next Publish) or **Dismiss**.

- **Review queue** shows the venues without a decision one at a time, those visitors are most likely to look at first: near the centre, next to confirmed terraces, from OSM before the Junta before Overture, bars, cafés and restaurants before pubs, and those with a machine proposal (`web/src/admin/queueScore.ts` has the score). The list says why each one is where it is. **T** (then a click on the map, or **Enter** to keep the venue position), **N**, **X** and **Y** decide and move on; **S** skips to the end. The header shows how far you are, by count and by share of the total value.
- **Not venues** lists Overture-only venues that are probably not a bar or restaurant (name, fast food, a duplicate of a venue from another source, far out or alone). Strong signals start ticked; **Mark N as not a venue** waits 10 s for **Undo** before it saves.
- **Machine proposals** from `pipeline/data/venue_proposals.csv` (`venue_id,kind,lat,lon,confidence,evidence,source,generated`; `kind` is `terrace`, `no_terrace`, `position` or `not_venue`; optional) show in the venue panel with their evidence and confidence, and a dashed pin on the map for a proposed position. **Accept** (**A**) saves the usual review row; **Ignore** (**I**) hides it for good (kept in `pipeline/.cache/venue_proposals_ignored.csv`).

### Fixing a terrace

1. Pick **Needs a look**: terraces whose current horizon gets no sun today, on 21 Jun or on 21 Dec, or is above 60° over most of the southern half. Usually the pin is against a wall, under a tree crown or on a roof.
2. Click one, press **T** and click (or drag the pin to) where the tables stand. The panel's **Sun at the terrace pin** updates as you go: today's hours of sun, a 24 h strip (amber sun, grey shade, light night) and the **height above ground** at the pin.
3. Read it:
   - **No sun** while the tables do get sun: the pin is in the shade of something the tables are not, typically tight against a façade or under a crown. Move it a few metres onto open ground, towards the middle of the tables.
   - **Height above ground** is the surface model minus the terrain under the pin. On the street it reads about 0 m. Above 2 m (the build's warning threshold) the pin sits on a roof, an awning or a tree crown, and its horizon is meaningless: move it to the pavement or square below.
   - **The pin is right and so is the result**, e.g. a narrow street between tall buildings that really gets little or no sun: press **Y** (*Looks right*). It keeps the terrace where it is and takes it off the list for good; moving its pin later puts it back. Note the 2 m LiDAR can't see the floor of very narrow streets, so their sun may read lower than it is.
4. **Publish** when done. The list is computed from the published `terraces.json`, so a fixed terrace leaves it after the next build ("pin moved since the build" until then).

### Prices from venue websites

```bash
cd pipeline && uv run python -m solycerveza.price_candidates   # --refresh to download the pages again
```

It reads the venues' own websites (never social networks, review sites or delivery apps), honouring robots.txt, and writes the caña and tercio prices it is sure about, with the page and the text they came from, to `pipeline/data/price_candidates.csv`. These are candidates: nothing reaches the app until you accept one, which copies it into `venue_prices.csv`. Menus published as PDF or image files are listed in `pipeline/.cache/menu_leads.csv` to read by hand. See [ADR-0006](docs/adr/0006-price-candidates-from-venue-websites.md).

### Machine proposals for unreviewed venues

```bash
cd pipeline
git show 164f946^:web/public/data/terraces.json > .cache/terraces_pre_review.json   # once
uv run python -m solycerveza.proposals --evaluate --baseline .cache/terraces_pre_review.json --yes
uv run python -m solycerveza.proposals --limit 50     # then the unreviewed venues, 50 at a time
```

Three proposers suggest answers for venues nobody has reviewed: a terrace (and where its tables are) read from the PNOA orthophoto by the Claude API (`ANTHROPIC_API_KEY`); a corrected position from the Junta register address (CartoCiudad); and "not a venue" for weak Overture places. They write `pipeline/data/venue_proposals.csv`, which the build never reads. See [ADR-0008](docs/adr/0008-machine-venue-proposals.md).

1. **Run the trial first.** `--evaluate` scores each proposer against your 106 decisions, as the venues were before you reviewed them. The commit `164f946^` is the last one before the first review (`164f946`, PR #78, the first venue review on `main`). Without `--baseline` it rebuilds that state from the cached sources. The report (stdout and `pipeline/.cache/proposals_eval.md`) gives precision and recall, pin distances, and the confidence that reaches 90 % precision. Only that run's vision calls cost money: the command prints the estimate, about $2–5 for the 87 venues with a terrace decision. Without `--yes` or `--limit N` it uses cached answers only.
2. **Trust a kind only above its threshold.** If the trial finds no threshold for a kind, ignore that kind.
3. **Then generate proposals** for the unreviewed venues (`--only vision,position,overture` picks proposers; `--min-confidence` sets the cut) and confirm them one by one in the admin.

Every change goes through a PR with green CI. [CLAUDE.md](CLAUDE.md) has the workflow, the quality gates and the conventions.

## Data and attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Basemap tiles by [OpenFreeMap](https://openfreemap.org). The service worker keeps a bounded copy of the basemap files a visitor has already loaded in that visitor's browser (at most 600 files, 30 days), so areas already seen work offline; the project does not store or redistribute them.
- More venues from [Overture Maps](https://overturemaps.org) (CDLA-Permissive-2.0, [licence text](web/public/data/licenses/CDLA-Permissive-2.0.txt)); see [ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md).
- Venues from the Junta de Extremadura's restaurant register (CC BY 4.0), geocoded with CartoCiudad (CC BY 4.0 ign.es); see [ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md).
- Terrace positions placed on the PNOA orthophoto © IGN (CC-BY 4.0).
- Surface and terrain models (PNOA-LiDAR 2nd coverage, flown 2018–19, 2 m): `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` and `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` (IGN/CNIG); [details](docs/research/lidar.md).
- Deciduous trees for the winter horizons (when built): `Contiene datos modificados de Copernicus Sentinel (2025)` (Sentinel-2 L2A, Copernicus open licence); [ADR-0007](docs/adr/0007-seasonal-trees.md).

## License

Code is MIT. `web/public/data/terraces.json` contains OpenStreetMap data and is released under the [ODbL](https://opendatacommons.org/licenses/odbl/); its other sources are credited inside the file ([data sources](docs/research/data-sources.md), [ADR-0002](docs/adr/0002-terrace-data-sources.md)).

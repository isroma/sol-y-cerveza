# The data pipeline

`pipeline/` (Python 3.14, [uv](https://docs.astral.sh/uv/)) runs offline, on the owner's machine. It builds `web/public/data/terraces.json`, the only data the app loads, following the [data contract](data-contract.md). The design is in [ADR-0001](adr/0001-architecture.md). Run every command below from `pipeline/` after `uv sync`.

## What the build produces

`python -m solycerveza.build` lists every named venue and, for each terrace, a 360° horizon profile: how high the surrounding buildings and trees rise in every direction, computed from a LiDAR surface model. The app only needs that and the sun's position, which it computes on the device.

Sources, in the order they are applied (a later one wins):

1. **Venues** from OSM, from Overture ([ADR-0003](adr/0003-venue-base-osm-plus-overture.md)) and recent entries of the Junta de Extremadura's restaurant register ([ADR-0004](adr/0004-junta-register-and-website-evidence.md)).
2. **Terraces** come only from OSM (`outdoor_seating=yes` on a venue, or a `leisure=outdoor_seating` point within 40 m, which then sets the terrace position) and from `pipeline/data/curated_terraces.csv`, which wins over OSM.
3. **Corrections**: wrong Overture or Junta venues are dropped through `pipeline/data/venue_corrections.csv`. Wrong OSM venues should be fixed in OSM instead.
4. **Reviews**: the admin's `pipeline/data/venue_review.csv` ([admin guide](admin.md)) is applied last, on top of everything else.
5. **Prices**: `pipeline/data/venue_prices.csv` is attached to each record as `prices` (integer cents).

`python -m solycerveza.build --refresh` downloads the venues from Overpass again instead of using the cache. Network calls happen only in fetch stages, and raw downloads are cached in `pipeline/.cache/` (gitignored).

## Rebuilding the data

```bash
cd pipeline
uv run python -m solycerveza.obstacles                 # surface + terrain rasters, once, from the 2 m MDS02/MDT02 sheets
                                                       # downloaded by hand (docs/research/lidar.md; the command says how)
# uv run python -m solycerveza.obstacles --source wcs  # fallback: automated 5 m MDS05/MDT05 (flown 2009–10); changes the attribution
uv run python -m solycerveza.leafoff                   # optional: leaf-off surface model for winter (ADR-0007)
uv run python -m solycerveza.build                     # venues + curated list + horizons -> terraces.json
```

- **`solycerveza.obstacles`** writes `pipeline/.cache/badajoz_dsm.tif` (surface) and `badajoz_dtm.tif` (terrain). By default it reads the 2 m PNOA-LiDAR MDS02/MDT02 sheets from `pipeline/.cache/cnig/mds02/` and `cnig/mdt02/` (other folders with `--dsm-dir` and `--dtm-dir`). CNIG downloads sit behind a reCAPTCHA, so the sheets are downloaded by hand; without them the command prints the steps. `--source wcs` downloads the older, coarser 5 m data instead. Products, licence and caveats: [LiDAR research](research/lidar.md).
- **`solycerveza.leafoff`** writes `pipeline/.cache/badajoz_dsm_leafoff.tif` (see below).
- **`solycerveza.build`** writes `web/public/data/terraces.json`. It flags a terrace pin more than `MAX_HEIGHT_ABOVE_GROUND_M` (2 m, in `build.py`) above the ground: it sits on a roof, an awning or a tree crown.

### Probing one point

```bash
uv run python -m solycerveza.probe --lat 38.8789 --lon -6.9707
```

It prints one JSON object: the horizon the build would store for a terrace there, the leaf-off one (`horizon_winter`, null when it is the same or there is no leaf-off model), the height above ground and the build's threshold. `--dsm`, `--dtm` and `--dsm-leafoff` override the raster paths. The admin's sun preview runs it (see [admin guide](admin.md#fixing-a-terrace)).

## Seasonal trees

From 1 December to 15 March the app uses each terrace's `horizon_winter`: the horizon with deciduous tree crowns removed ([ADR-0007](adr/0007-seasonal-trees.md)). `solycerveza.leafoff` builds it from the DSM, the DTM, OSM building footprints (Overpass) and a Sentinel-2 NDVI composite (public COGs on AWS, no account). It writes `pipeline/.cache/badajoz_dsm_leafoff.tif`. Without that file the build writes no winter horizons and the app behaves as before.

To check a rebuild:

1. `git diff --stat web/public/data/terraces.json`: count the terraces that gained a `horizon_winter` (the build also logs it). In the city centre, expect tens, not hundreds.
2. Open `pipeline/.cache/badajoz_dsm_leafoff.tif` and `badajoz_dsm.tif` in QGIS and look at their difference: only tree crowns should be lowered, never a roof, the city walls or the Alcazaba.
3. Pick 3–5 terraces you know: some under plane trees or mulberries (they should gain a winter horizon), and some under orange trees, palms or pines (they should not). Run the app with the clock in January (or the admin probe) and compare.
4. If evergreens come out as bare, raise `WINTER_DROP_MIN_NDVI` in `pipeline/src/solycerveza/leafoff.py`. If plane-tree squares are missed, lower it, or `SUMMER_MIN_NDVI`. Say what you changed in the PR.

## Map shadows

The map's sun shadows (`web/src/map/prismShadows.ts`) are flat polygons cast on the GPU from the objects the map draws, so every shadow has a visible caster: the [LiDAR buildings](#lidar-buildings) and the [tree crowns](#tree-crowns). A worker (`prismWorker.ts`) fetches both files, decodes them with the shared codec (`extrusionCodec.ts`) and builds, once, every outline edge with its base and top height, plus the triangulated outline of each floating crown band, sorted into 250 m cells (`prismGeometry.ts`); the layer uploads them as vertex buffers (about 8 MB). For each edge the vertex shader draws a ground quad from the edge at its base to the edge at its top, each pushed away from the sun by height ÷ tan(altitude) (at most 300 m, as far as the terrace horizons look); a crown band adds its outline pushed by its base. Together these cover exactly each prism's shadow on flat ground. The sun is two uniforms, so moving the time slider recasts nothing. Each pixel is shaded once (depth test at the layer's own depth), so overlaps don't darken; only the cells near the view are drawn. There is no terrain: shadows fall on a flat ground plane. MapLibre drops custom layers when the WebGL context is lost; `MapView.tsx` re-adds them, with the rest of its runtime setup, once the context is back.

Against the list, at the list's terraces and sun steps, the prisms agree 85.6 % of the time (an earlier prototype that marched through height tiles of the DSM and DTM agreed 94.5 % on the same data, and was dropped for it): no terrain, one height per building, merged and simplified outlines and banded crowns cost about 9 points. The owner prefers the clean polygons; the list's answer still comes from the full horizon.

Large files stay off `main`: `buildings.json` and `trees.json` live on the orphan branch `height-tiles` (the name is historical; the deploy uses it), which every Pages deploy copies into the site's `data/` (`.github/workflows/deploy-pages.yml`). To update one, rebuild it (below) and replace it there in one commit:

```sh
git worktree add ../height-tiles height-tiles
cp web/public/data/buildings.json web/public/data/trees.json ../height-tiles/
cd ../height-tiles && git add -A && git commit -m "data: rebuild LiDAR buildings and trees" && git push
```

The next deploy of `main` picks them up (or run **Deploy web to GitHub Pages** by hand).

### LiDAR buildings

OSM has almost no building heights in Badajoz, so the basemap draws nearly every building at its 5 m default, while the shadows are cast from the LiDAR. So the map draws its own buildings (`web/src/map/lidarBuildings.ts`): once `buildings.json` has loaded it hides the basemap's `building-3d` and `building-roof`, which stand in until then and stay if it never loads (offline with nothing cached, a 404), at the basemap's own heights and without shadows. `python -m solycerveza.buildings [--sources <csv>]` writes `web/public/data/buildings.json` (gitignored): every OSM `building=*` footprint (not `roof`) from the Overpass structures cache, at the 75th percentile of the surface height inside it, 1 m in from its edge (closer than the median to the rim that casts the shadow). Where the LiDAR finds under 2 m (newer than the 2018–19 flight), the height is `building:levels` × 3 m, or else 3 m; `--sources` lists each building's height and source. Touching buildings within 1.5 m of each other's height are merged, and outlines are simplified by 0.5 m. Same compact format as `trees.json`, drawn at real heights (no ×1.4). About 12,900 buildings in 8,100 outlines, 0.5 MB (0.16 MB gzipped). It lives on the `height-tiles` branch; the deploy copies it to `data/buildings.json`.

### Tree crowns

The shadows include trees' shade, so the map also draws the trees, from the same LiDAR, and casts their shadows. `python -m solycerveza.trees` writes `web/public/data/trees.json` (gitignored): cells at least 2.5 m above the terrain and clear of OSM buildings and structures (buffered 4 m), with shapes narrower than 6 m opened away, polygonized in height bands (2.5, 7, 13 m), smoothed and simplified (1.5 m); crowns under 30 m² are dropped. Each polygon rises to its own crown's height (95th percentile of its cells), capped where the next band starts. The file is a compact JSON, not GeoJSON: polygons grouped by base and top, with coordinates as integer steps of 1e-5° (`encode` in `trees.py`). The app decodes it inside MapLibre's workers (`web/src/map/extrusionCodec.ts`, loaded by `importScriptInWorkers`), so the main thread does no work for it. About 21,600 polygons, 1.2 MB (0.35 MB gzipped). Unmapped buildings, kiosks and awnings come out as trees too. With the [leaf-off surface model](#seasonal-trees), the crown cells it lowers (deciduous) and the ones it keeps are polygonized apart: polygons are then grouped by base, top and that tag, and `d` lists one flag per group (1 = deciduous; older clients ignore it). Splitting the crowns, rather than tagging whole ones by the share of cells lowered, leaves exactly the leaf-off model's crowns standing in winter, which is what the list's winter horizons see (December agreement with the list, prism rule: 88.3 % split, 86.4 % tagging crowns at least half lowered, 87.0 % with no winter on the map). From 1 December to 15 March, when `terraces.json` has winter horizons (the list's rule, `web/src/sun/leafOff.ts`), the map draws those crowns bare and casts no shadow from them. It lives on the `height-tiles` branch; the deploy copies it to `data/trees.json`. Rebuild it after the leaf-off model changes.

## Prices from venue websites

```bash
cd pipeline && uv run python -m solycerveza.price_candidates   # --refresh to download the pages again
```

It reads the venues' own websites (the URLs in OSM and Overture; never social networks, review sites, booking or delivery apps, or addresses on a private network), honouring robots.txt, one request at a time, HTML only, cached in `pipeline/.cache/websites/`. It writes the caña and tercio prices it is sure about, with the page and the text they came from, to `pipeline/data/price_candidates.csv`.

These are candidates, not prices: the build never reads that file, and nothing reaches the app until the owner accepts one in the admin, which copies it into `venue_prices.csv` with `seen` set to the fetch date ([admin guide](admin.md#prices)). Menus published as PDF or image files are only listed in `pipeline/.cache/menu_leads.csv`, to read by hand. See [ADR-0006](adr/0006-price-candidates-from-venue-websites.md).

## Machine proposals for unreviewed venues

```bash
cd pipeline
git show 164f946^:web/public/data/terraces.json > .cache/terraces_pre_review.json   # once
uv run python -m solycerveza.proposals --evaluate --baseline .cache/terraces_pre_review.json --yes
uv run python -m solycerveza.proposals --limit 50     # then the unreviewed venues, 50 at a time
```

Three proposers suggest answers for venues nobody has reviewed (not in `venue_review.csv`), each optional and cached in `pipeline/.cache/`:

- a terrace (and where its tables are) read from a PNOA orthophoto crop by the Claude API (`ANTHROPIC_API_KEY`);
- a corrected position from the Junta register address, through its CartoCiudad portal;
- "not a venue" for weak Overture places, from their attributes.

They write `pipeline/data/venue_proposals.csv` (`venue_id,kind,lat,lon,confidence,evidence,source,generated`; `kind` is `terrace`, `no_terrace`, `position` or `not_venue`). These are proposals, not data: the build never reads the file, and the owner confirms each one in the admin ([admin guide](admin.md#machine-proposals)). See [ADR-0008](adr/0008-machine-venue-proposals.md).

1. **Run the trial first.** `--evaluate` scores each proposer against your 106 decisions, as the venues were before you reviewed them. The commit `164f946^` is the last one before the first review (`164f946`, PR #78, the first venue review on `main`). Without `--baseline` it rebuilds that state from the cached sources. The report (stdout and `pipeline/.cache/proposals_eval.md`) gives precision and recall, pin distances, and the confidence that reaches 90 % precision. Only that run's vision calls cost money: the command prints the estimate, about $2–5 for the 87 venues with a terrace decision. Without `--yes` or `--limit N` it uses cached answers only and makes no new calls.
2. **Trust a kind only above its threshold.** If the trial finds no threshold for a kind, ignore that kind.
3. **Then generate proposals** for the unreviewed venues (`--only vision,position,overture` picks proposers; `--min-confidence` sets the cut) and confirm them one by one in the admin.

### Vision answers from a Claude Code session (no API key)

A Claude Code session can look at the crops itself instead of the API:

```bash
cd pipeline
uv run python -m solycerveza.vision_session export --evaluate --baseline .cache/terraces_pre_review.json
# (or, for unreviewed venues: export --limit 50)
# the session answers each task in .cache/vision-session/tasks.json and saves a JSON list
uv run python -m solycerveza.vision_session import answers.json
uv run python -m solycerveza.proposals --vision session --evaluate --baseline .cache/terraces_pre_review.json
```

`export` fetches the crops still without a session answer and writes a task file holding only what the judge may see: an opaque key, the venue's name and kind, the crop and the API's own prompt (no venue id, no decision). `import` checks the whole file (known keys, no duplicates, the `VisionAnswer` shape, a pixel inside the image for "yes") and caches nothing unless every answer is valid. Answers are cached under the model label `claude-code-session` and give proposals with the source `pnoa-ortho+claude-session`, so they never mix with API answers; `--vision session` reads them and never calls the API.

For a blind trial, have subagents judge the crops, each given only its share of the task file and told not to read `pipeline/data/` or `terraces.json`.

**Trial result (2026-11-25, #388):** on the 109 venues with a terrace decision, 91 answers were "unsure"; `terrace` reached 67 % precision (8/12) and 15 % recall, `no_terrace` 50 % (3/6) and 5 %, and no confidence threshold gives 90 % precision for either, so neither kind is trusted. The right pins were a median 10 m (p90 48 m) from the owner's, against 9 m (p90 27 m) for the pre-review position. Details in [ADR-0008](adr/0008-machine-venue-proposals.md#consequences).

## OSM write-back

```bash
cd pipeline && uv run python -m solycerveza.osm_export [--add <venue_id>]
```

It turns the admin's reviews into `pipeline/.cache/osm-review.osm`, a JOSM file holding only what OSM still lacks:

- `outdoor_seating=yes` / `no` on OSM venues reviewed as `terrace` / `no_terrace`;
- corrected positions of OSM venue nodes (ways and their nodes are never moved);
- new `leisure=outdoor_seating` nodes for terraces placed away from their venue, unless OSM already has one nearby.

The owner checks the file in JOSM and uploads it under their own OSM account; nothing uploads automatically. Venues from Overture, the Junta or `review:` go in only with `--add`, after a survey, because those licences don't allow copying into OSM. Running it again is safe: anything OSM already has is left out.

## Files in `pipeline/data/`

| File                    | Columns                                                                                      | Written by                                                 | Read by the build                         |
| ----------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| `curated_terraces.csv`  | `id,venue_id,name,kind,terrace_lat,terrace_lon,verified,ayto_ref,notes`                      | hand                                                       | yes: terraces, winning over OSM           |
| `venue_corrections.csv` | `venue_id,action,notes` (`action` is `drop`)                                                 | hand                                                       | yes: drops wrong Overture or Junta venues |
| `venue_review.csv`      | `venue_id,status,name,kind,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed,looks_right` | the admin                                                  | yes: applied last, wins over everything   |
| `venue_prices.csv`      | `venue_id,item,brand,cents,seen`                                                             | the admin (by hand, from a photo or an accepted candidate) | yes: each record's `prices`               |
| `price_candidates.csv`  | `venue_id,item,brand,cents,source_url,snippet,fetched,status`                                | `solycerveza.price_candidates`; the admin sets `status`    | **never**                                 |
| `venue_proposals.csv`   | `venue_id,kind,lat,lon,confidence,evidence,source,generated`                                 | `solycerveza.proposals`                                    | **never**                                 |

`venue_review.csv` columns: `status` is `terrace`, `no_terrace`, `not_venue` (the venue is dropped) or empty when only the position was fixed; `name` and `kind` only for `review:<slug>` venues added in the admin; `looks_right` is `yes` for a terrace the owner checked and found right (older files may lack the column). `venue_prices.csv`: `item` is `cana` or `tercio`, `brand` is required for a tercio, `cents` is an integer. `venue_proposals.csv` holds only its header in the repository: its rows are a local work list, and Publish does not ship them. Details are in the docstrings of `review.py`, `prices.py`, `corrections.py` and `terraces.py` in `pipeline/src/solycerveza/`.

## Quality gate

```bash
cd pipeline && uv sync && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest
```

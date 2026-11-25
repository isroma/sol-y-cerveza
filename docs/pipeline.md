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

## Shadow height tiles

The map's prototype sun shadows (`?shade=gpu`, `web/src/map/heightShadows.ts`) march from each ground pixel towards the sun through the same DSM and DTM the terrace horizons use, so trees and terrain cast shadows and the map agrees with the list. `python -m solycerveza.heightmap` reprojects both rasters to Web Mercator zoom-15 tiles of 512 px (about 1.9 m a pixel) and writes PNGs to `web/public/data/heights/{x}/{y}.png` (gitignored: rasters are never committed). Each pixel packs the surface elevation in decimetres (R, G) and its height above the terrain in quarter metres (B). The city is 110 tiles, about 14 MB.

Rasters stay off `main`: the tiles live on the orphan branch `height-tiles` (`{x}/{y}.png` at its root), and the Pages deploy copies it into the site's `data/heights/` (`.github/workflows/deploy-pages.yml`). The dev server reads them from `web/public/data/heights`. Regenerate only when the DSM or DTM changes, then replace the branch's tiles in one commit:

```sh
git worktree add ../height-tiles height-tiles
rm -rf ../height-tiles/[0-9]* && cp -R web/public/data/heights/* ../height-tiles/
cd ../height-tiles && git add -A && git commit -m "data: regenerate shadow height tiles" && git push
```

The next deploy of `main` picks them up (or run **Deploy web to GitHub Pages** by hand).

### Tree crowns

The GPU shadows include trees' shade, so with `?shade=gpu` the map also draws the trees, from the same LiDAR. `python -m solycerveza.trees` writes `web/public/data/trees.json` (gitignored): cells at least 2.5 m above the terrain and clear of OSM buildings and structures (buffered 4 m), with shapes narrower than 6 m opened away, polygonized in height bands (2.5, 6, 11, 17 m) and smoothed. Each feature has `b` (base) and `h` (top) in metres. About 24,000 polygons, 9.4 MB (1.3 MB gzipped). Unmapped buildings, kiosks and awnings come out as trees too. It lives on the `height-tiles` branch next to the tiles; the deploy copies it to `data/trees.json`.

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
- a corrected position from a street address, through its CartoCiudad portal: the Junta register row that matches the venue (`junta+cartociudad`), the venue's own OSM `addr:street` + `addr:housenumber` (`osm-addr+cartociudad`) or its Overture `addresses` line (`overture-addr+cartociudad`). The trial scores each of the three apart. Overture parquets downloaded before #350 have no `addresses` column: re-run `uv run python -m solycerveza.overture`. The first run geocodes the new addresses (about one CartoCiudad request per address, cached in `.cache/cartociudad_portals.json` with the register's);
- "not a venue" for weak Overture places, from their attributes.

They write `pipeline/data/venue_proposals.csv` (`venue_id,kind,lat,lon,confidence,evidence,source,generated`; `kind` is `terrace`, `no_terrace`, `position` or `not_venue`). These are proposals, not data: the build never reads the file, and the owner confirms each one in the admin ([admin guide](admin.md#machine-proposals)). See [ADR-0008](adr/0008-machine-venue-proposals.md).

1. **Run the trial first.** `--evaluate` scores each proposer against your 106 decisions, as the venues were before you reviewed them. The commit `164f946^` is the last one before the first review (`164f946`, PR #78, the first venue review on `main`). Without `--baseline` it rebuilds that state from the cached sources. The report (stdout and `pipeline/.cache/proposals_eval.md`) gives precision and recall, pin distances, and the confidence that reaches 90 % precision. Only that run's vision calls cost money: the command prints the estimate, about $2–5 for the 87 venues with a terrace decision. Without `--yes` or `--limit N` it uses cached answers only and makes no new calls.
2. **Trust a kind only above its threshold.** If the trial finds no threshold for a kind, ignore that kind.
3. **Then generate proposals** for the unreviewed venues (`--only vision,position,overture` picks proposers; `--min-confidence` sets the cut) and confirm them one by one in the admin.

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

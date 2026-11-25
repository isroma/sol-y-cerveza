# height-tiles

Data files for the map that stay off `main` (large, and rebuilt from the LiDAR rather than edited).
Every GitHub Pages deploy of `main` copies them into the site's `data/`
(`.github/workflows/deploy-pages.yml`; the deploy fails if this branch is missing, so keep its name).

`buildings.json`: OSM building outlines at their LiDAR heights (75th percentile of the surface height
inside each, 1 m in from its edge), merged and simplified. Written by
`cd pipeline && uv run python -m solycerveza.buildings`.

`trees.json`: tree crowns from the same LiDAR (cells at least 2.5 m above the terrain, clear of OSM
buildings), in height bands, with deciduous crowns flagged for the winter map. Written by
`cd pipeline && uv run python -m solycerveza.trees`.

Both use the compact format decoded by `web/src/map/extrusionCodec.ts` on `main`: polygons grouped as
`[base m, top m, polygons]`, coordinates as integer steps of 1e-5°. The map draws them and casts their
sun shadows on the GPU (`web/src/map/prismShadows.ts`). To update one, replace it here in one commit
(see docs/pipeline.md on `main`); the next deploy of `main` picks it up.

Sources: PNOA-LiDAR MDS02 and MDT02 © Instituto Geográfico Nacional (CC BY 4.0); contains data derived
from © OpenStreetMap contributors (ODbL).

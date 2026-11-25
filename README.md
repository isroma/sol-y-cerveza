# height-tiles

Shadow height tiles for the map's GPU sun shadows (`web/src/map/heightShadows.ts` on `main`).
Rasters stay off `main`; the GitHub Pages deploy copies this branch into `data/heights/`.

`{x}/{y}.png`: Web Mercator zoom-15 tiles of 512 px. R, G = surface (DSM) elevation in decimetres
(big-endian 16-bit, 0 = no data); B = height above the terrain in quarter metres (max 255).
Source: PNOA-LiDAR MDS02 and MDT02 © Instituto Geográfico Nacional (CC BY 4.0).

`trees.json`: tree crowns from the same LiDAR (cells at least 2.5 m above the terrain, clear of OSM
buildings), as GeoJSON polygons in height bands (`b` base, `h` top, metres). Contains data derived from
© OpenStreetMap contributors (ODbL). The deploy copies it to `data/trees.json`.

Regenerate with `cd pipeline && uv run python -m solycerveza.heightmap` (and `solycerveza.trees`), then replace
this branch's files with `web/public/data/heights/` in one commit (see docs/pipeline.md on `main`).

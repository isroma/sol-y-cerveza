# Sol y Cerveza ☀️🍺

Which bar and restaurant terraces in Badajoz get sun or shade, for any date and time.

- **Web:** <https://isroma.github.io/sol-y-cerveza/>
- **iOS / Android:** Capacitor shells exist, paused until the web version is polished

## How it works

```
pipeline/ (offline, Python)                         web/ (static, TypeScript)
venues + terrace positions ─┐
LiDAR surface model ────────┴─► horizon profile ──► web/public/data/ ──► sun position for the chosen
                                 per terrace (360°)   terraces.json       date/time vs. horizon → sun / shade
```

Shade is precomputed as each terrace's horizon: how high the surrounding buildings and trees rise in every direction. The app then only needs the sun's position, which it computes on the device for any date. Details: [ADR-0001](docs/adr/0001-architecture.md) and the [data contract](docs/data-contract.md).

## Roadmap

1. [Decide where terrace data comes from](https://github.com/isroma/sol-y-cerveza/issues/2): OSM alone has almost no terrace tags in Badajoz
2. [Terrace dataset](https://github.com/isroma/sol-y-cerveza/issues/3)
3. [Obstacle surface from PNOA LiDAR](https://github.com/isroma/sol-y-cerveza/issues/4)
4. [Horizon profiles](https://github.com/isroma/sol-y-cerveza/issues/5)
5. [Sun/shade map for any date and time](https://github.com/isroma/sol-y-cerveza/issues/6)
6. [iOS and Android apps](https://github.com/isroma/sol-y-cerveza/issues/7) (shells built, paused until the web version is polished)
7. [Median beer price per venue (v2)](https://github.com/isroma/sol-y-cerveza/issues/8)

## Development

You need Node 26 and [uv](https://docs.astral.sh/uv/).

```bash
cd web && npm ci && npm run dev        # web app on http://localhost:5173
cd pipeline && uv sync && uv run pytest
```

To rebuild the data (`web/public/data/terraces.json`) from `pipeline/`:

```bash
uv run python -m solycerveza.obstacles --source wcs   # surface + terrain rasters, once (see docs/research/lidar.md for the 2 m data)
uv run python -m solycerveza.build                     # venues + curated list + horizons -> terraces.json
```

Every change goes through a PR with green CI. [CLAUDE.md](CLAUDE.md) has the workflow, the quality gates and the conventions.

## Data and attribution

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL). Basemap tiles by [OpenFreeMap](https://openfreemap.org).
- More venues from [Overture Maps](https://overturemaps.org) (CDLA-Permissive-2.0, [licence text](web/public/data/licenses/CDLA-Permissive-2.0.txt)); see [ADR-0003](docs/adr/0003-venue-base-osm-plus-overture.md).
- Venues from the Junta de Extremadura's restaurant register (CC BY 4.0), geocoded with CartoCiudad (CC BY 4.0 ign.es); see [ADR-0004](docs/adr/0004-junta-register-and-website-evidence.md).
- Terrace positions placed on the PNOA orthophoto © IGN (CC-BY 4.0).
- Surface and terrain models (PNOA-LiDAR 2nd coverage, flown 2018–19, 2 m): `Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es` and `Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es` (IGN/CNIG); [details](docs/research/lidar.md).

## License

Code is MIT. `web/public/data/terraces.json` contains OpenStreetMap data and is released under the [ODbL](https://opendatacommons.org/licenses/odbl/); its other sources are credited inside the file ([data sources](docs/research/data-sources.md), [ADR-0002](docs/adr/0002-terrace-data-sources.md)).

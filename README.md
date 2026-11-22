# Sol y Cerveza ☀️🍺

Terrazas de bares y restaurantes de Badajoz, y si les da el sol o la sombra según la fecha y la hora.

Which bar and restaurant terraces in Badajoz get sun or shade, for any date and time.

- **Web:** <https://isroma.github.io/sol-y-cerveza/>
- **iOS / Android:** planned, via Capacitor ([#7](https://github.com/isroma/sol-y-cerveza/issues/7))

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
6. [iOS and Android apps](https://github.com/isroma/sol-y-cerveza/issues/7)
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
- Surface and terrain models: `Obra derivada de MDS05 2008-2015 CC-BY 4.0 scne.es` and `Obra derivada de MDT05-cob1 2008-2015 CC-BY 4.0 scne.es` (IGN/CNIG). The wording changes if the 2 m models are used ([details](docs/research/lidar.md)).

## License

Code is MIT. Generated datasets keep the licences of their sources ([data sources](docs/research/data-sources.md)).

"""Assemble `web/public/data/terraces.json` (see docs/data-contract.md) from every pipeline stage.

1. Base terrace records: OSM venues plus the curated list (`solycerveza.terraces`).
2. Surface and terrain rasters: run `python -m solycerveza.obstacles` once beforehand.
3. One horizon profile per terrace (`solycerveza.horizon`), plus a leaf-off one
   (`horizon_winter`, ADR-0007) when `python -m solycerveza.leafoff` has written its surface model.
4. A horizon envelope across each terrace (`horizon_low`/`horizon_high` and their leaf-off twins,
   `solycerveza.envelope`): the lowest and highest obstacle over ground points round the pin.

Run `python -m solycerveza.build [--refresh]` from `pipeline/`. `--refresh` re-downloads the
venues from Overpass instead of using the cache.
"""

import argparse
import json
import logging
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from functools import partial
from pathlib import Path
from typing import Literal

import rasterio
from pydantic import BaseModel, ConfigDict, field_serializer
from pyproj import Transformer

from solycerveza.envelope import LatLonPair, Structures, envelope, ground_points, sample_points
from solycerveza.horizon import terrace_horizon
from solycerveza.leafoff import LEAFOFF_DSM_PATH, load_structures
from solycerveza.prices import prices_by_venue, read_prices
from solycerveza.review import dropped_ids, read_review, review_terraces, review_venues
from solycerveza.sources import load_all_venues
from solycerveza.terraces import Terrace, build_terraces, read_curated
from solycerveza.venues import CACHE_DIR, load_seating

logger = logging.getLogger(__name__)

OUTPUT = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terraces.json"
DSM_PATH = CACHE_DIR / "badajoz_dsm.tif"
DTM_PATH = CACHE_DIR / "badajoz_dtm.tif"
# Attribution lines are shown in the app, so they are in Spanish like the rest of the UI.
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"
PNOA_ATTRIBUTION = "Posiciones de terrazas sobre ortofoto PNOA © IGN (CC-BY 4.0)"
JUNTA_ATTRIBUTION = (
    "Más locales: Registro de restauración de la Junta de Extremadura (CC BY 4.0), "
    "geocodificado con CartoCiudad (CC BY 4.0 ign.es)"
)
OVERTURE_ATTRIBUTION = (
    "Más locales: Overture Maps Foundation, CDLA-Permissive-2.0 (licencia en data/licenses/)"
)
# A terrace point higher than this above the terrain is on a roof or under a canopy: the
# horizon from there is meaningless (roof) or all shade (canopy), so a curator should check it.
MAX_HEIGHT_ABOVE_GROUND_M = 2.0

HorizonFn = Callable[[float, float], list[int]]
PointsFn = Callable[[float, float], list[LatLonPair]]


class TerracesFile(BaseModel):
    """The whole file, mirroring `TerracesFile` in docs/data-contract.md (field order included)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: Literal[2] = 2
    generated: datetime
    sample: bool
    attribution: list[str]
    terraces: list[Terrace]

    @field_serializer("generated")
    def _utc_z(self, value: datetime) -> str:
        return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def add_horizons(
    terraces: Sequence[Terrace],
    horizon_for: HorizonFn,
    winter_for: HorizonFn | None = None,
    points_for: PointsFn | None = None,
) -> list[Terrace]:
    """Return copies of `terraces` with `horizon` computed at each terrace position.

    With `winter_for`, also sets `horizon_winter` (ADR-0007), but only where it differs from
    `horizon`: null means "same as horizon", which keeps the file small.

    With `points_for`, which gives the ground points across the terrace (`solycerveza.envelope`),
    also sets the envelope `horizon_low`/`horizon_high` over them, and its leaf-off twin with
    `winter_for`. Each is null where it adds nothing to what the app would use without it: the
    summer envelope when every point sees `horizon`, the winter one when it equals the summer
    envelope (or, without one, `horizon_winter` at every point).

    Venues without a terrace are returned unchanged. Re-validates every record, so a malformed
    profile fails here rather than in the app.
    """
    result: list[Terrace] = []
    for t in terraces:
        if t.terrace is None:
            result.append(t)
            continue
        pin = (t.terrace.lat, t.terrace.lon)
        horizon = horizon_for(*pin)
        winter = None if winter_for is None else winter_for(*pin)
        record = {
            **t.model_dump(),
            "horizon": horizon,
            "horizon_winter": None if winter == horizon else winter,
        }
        points = [] if points_for is None else points_for(*pin)
        if points:
            summer = envelope([horizon if p == pin else horizon_for(*p) for p in points])
            if summer != (horizon, horizon):
                record["horizon_low"], record["horizon_high"] = summer
            if winter_for is not None and winter is not None:
                leafoff = envelope([winter if p == pin else winter_for(*p) for p in points])
                fallback = summer if summer != (horizon, horizon) else (winter, winter)
                if leafoff != fallback:
                    record["horizon_low_winter"], record["horizon_high_winter"] = leafoff
        result.append(Terrace.model_validate(record))
    return result


def raster_attribution(path: Path) -> str:
    """The attribution line `solycerveza.obstacles` stored in the raster's SOURCE tag."""
    with rasterio.open(path) as dataset:
        source = dataset.tags().get("SOURCE")
    if not source:
        raise ValueError(f"{path} has no SOURCE tag; rebuild it with solycerveza.obstacles")
    return str(source)


def height_above_ground(lat: float, lon: float, dsm_path: Path, dtm_path: Path) -> float | None:
    """Surface minus terrain at a WGS84 point, or None where either raster has no data."""
    values: list[float] = []
    for path in (dsm_path, dtm_path):
        with rasterio.open(path) as dataset:
            to_raster = Transformer.from_crs("EPSG:4326", dataset.crs, always_xy=True)
            x, y = to_raster.transform(lon, lat)
            left, bottom, right, top = dataset.bounds
            if not (left <= x < right and bottom < y <= top):
                return None
            value = float(next(dataset.sample([(x, y)]))[0])
            if dataset.nodata is not None and value == float(dataset.nodata):
                return None
            values.append(value)
    return values[0] - values[1]


def position_warnings(terraces: Sequence[Terrace], dsm_path: Path, dtm_path: Path) -> list[str]:
    """One message per terrace whose point sits on a roof or under a canopy."""
    warnings: list[str] = []
    for t in terraces:
        if t.terrace is None:
            continue
        height = height_above_ground(t.terrace.lat, t.terrace.lon, dsm_path, dtm_path)
        if height is not None and height > MAX_HEIGHT_ABOVE_GROUND_M:
            warnings.append(
                f"{t.id} ({t.name}): terrace point is {height:.1f} m above the ground "
                "(roof or canopy?); check its position"
            )
    return warnings


def attribution_lines(
    terraces: Sequence[Terrace],
    dsm_path: Path,
    dtm_path: Path,
    leafoff_path: Path | None = None,
) -> list[str]:
    """Credits for every source the file is derived from."""
    lines = [OSM_ATTRIBUTION, raster_attribution(dsm_path), raster_attribution(dtm_path)]
    if leafoff_path is not None and any(t.horizon_winter is not None for t in terraces):
        lines.append(raster_attribution(leafoff_path))
    # Positions read off the PNOA orthophoto: curated terraces and pins placed in
    # the admin (`review`, which may use its orthophoto basemap).
    if any({"curated", "review"} & set(t.sources) for t in terraces):
        lines.append(PNOA_ATTRIBUTION)
    if any("overture" in t.sources for t in terraces):
        lines.append(OVERTURE_ATTRIBUTION)
    if any("junta" in t.sources for t in terraces):
        lines.append(JUNTA_ATTRIBUTION)
    return lines


def render(file: TerracesFile) -> str:
    """Serialize per the contract: 2-space indent, each horizon on one line, trailing newline.

    Null envelope keys are left out (`Terrace`; the contract makes them optional).
    """
    text = json.dumps(file.model_dump(mode="json"), ensure_ascii=False, indent=2)
    text = re.sub(
        r'"(horizon(?:_low|_high)?(?:_winter)?)": \[([^\]]*)\]',
        lambda m: f'"{m.group(1)}": [' + re.sub(r"\s+", "", m.group(2)) + "]",
        text,
    )
    return text + "\n"


def build(
    *,
    refresh: bool = False,
    dsm_path: Path = DSM_PATH,
    dtm_path: Path = DTM_PATH,
    leafoff_path: Path | None = LEAFOFF_DSM_PATH,
    generated: datetime | None = None,
) -> TerracesFile:
    """Run every stage and return the file contents.

    `horizon_winter` is computed only if `leafoff_path` exists (ADR-0007); otherwise it is null
    everywhere and the app uses `horizon` all year.
    """
    reviews = read_review()
    dropped = dropped_ids(reviews)
    terraces = build_terraces(
        review_venues(load_all_venues(refresh=refresh), reviews),
        [row for row in read_curated() if row.venue_id not in dropped],
        load_seating(refresh=False),
    )
    terraces = review_terraces(terraces, reviews)
    prices = prices_by_venue(read_prices(), {t.id for t in terraces})
    terraces = [
        t.model_copy(update={"prices": prices[t.id]}) if t.id in prices else t for t in terraces
    ]

    for warning in position_warnings(terraces, dsm_path, dtm_path):
        logger.warning(warning)

    def horizon_for(lat: float, lon: float) -> list[int]:
        return terrace_horizon(lat, lon, dsm_path, dtm_path=dtm_path)

    leafoff = leafoff_path if leafoff_path is not None and leafoff_path.exists() else None
    winter_for: HorizonFn | None = None
    if leafoff is not None:
        winter_for = partial(terrace_horizon, dsm_path=leafoff, dtm_path=dtm_path)
    else:
        logger.info("no leaf-off surface model: horizon_winter stays null (ADR-0007)")

    structures = Structures(load_structures())

    def points_for(lat: float, lon: float) -> list[LatLonPair]:
        return ground_points(
            sample_points(lat, lon),
            partial(height_above_ground, dsm_path=dsm_path, dtm_path=dtm_path),
            structures.contains,
        )

    terraces = add_horizons(terraces, horizon_for, winter_for, points_for)
    logger.info(
        "%d terraces get a sun envelope (partial sun), %d a leaf-off one",
        sum(t.horizon_low is not None for t in terraces),
        sum(t.horizon_low_winter is not None for t in terraces),
    )
    if leafoff is not None:
        logger.info(
            "%d terraces get a winter horizon (bare deciduous trees)",
            sum(t.horizon_winter is not None for t in terraces),
        )
    return TerracesFile(
        generated=generated or datetime.now(UTC),
        sample=False,
        attribution=attribution_lines(terraces, dsm_path, dtm_path, leafoff),
        terraces=terraces,
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write web/public/data/terraces.json.")
    parser.add_argument(
        "--refresh", action="store_true", help="download venues from Overpass even if cached"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    missing = [p for p in (DSM_PATH, DTM_PATH) if not p.exists()]
    if missing:
        logger.error(
            "missing %s: run `python -m solycerveza.obstacles` first",
            ", ".join(str(p) for p in missing),
        )
        return 2

    file = build(refresh=args.refresh)
    OUTPUT.write_text(render(file), encoding="utf-8")
    logger.info("%d terraces -> %s", len(file.terraces), OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

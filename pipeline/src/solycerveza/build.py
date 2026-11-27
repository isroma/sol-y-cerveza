"""Assemble `web/public/data/terraces.json` (see docs/data-contract.md) from every pipeline stage.

1. Base terrace records: OSM venues plus the curated list (`solycerveza.terraces`).
2. Surface and terrain rasters: run `python -m solycerveza.obstacles` once beforehand.
3. One horizon profile per terrace (`solycerveza.horizon`), plus a leaf-off one
   (`horizon_winter`, ADR-0007) when `python -m solycerveza.leafoff` has written its surface model.
4. A horizon envelope across each terrace (`horizon_low` and its leaf-off twin,
   `solycerveza.envelope`): the lowest obstacle over ground points within 7 m of the pin, off
   the road (`solycerveza.roads`).
5. Accepted sun reports as horizon caps (`sun_corrections`, `solycerveza.sun_corrections`), and
   accepted shade reports as floors (`shade_corrections`).

Run `python -m solycerveza.build [--refresh]` from `pipeline/`. `--refresh` re-downloads the
venues from Overpass instead of using the cache.
"""

import argparse
import json
import logging
import re
from collections.abc import Callable, Sequence
from contextlib import ExitStack
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Self

import rasterio
from pydantic import BaseModel, ConfigDict, field_serializer
from pyproj import Transformer

from solycerveza.envelope import (
    LatLonPair,
    SampleGrid,
    Structures,
    lowest,
    pack_low,
    terrace_points,
)
from solycerveza.horizon import HorizonModel
from solycerveza.leafoff import LEAFOFF_DSM_PATH, load_structures
from solycerveza.prices import prices_by_venue, read_prices
from solycerveza.review import dropped_ids, read_review, review_terraces, review_venues
from solycerveza.roads import Carriageways, load_roads
from solycerveza.sources import load_all_venues
from solycerveza.sun_corrections import read_sun_reports, sun_corrections_by_venue
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
    also sets the envelope `horizon_low`, the lowest obstacle over them (packed, see
    `solycerveza.envelope`), and its leaf-off twin `horizon_low_winter` with `winter_for`. Each
    is null where it adds nothing to what the app would use without it: the summer one when it
    equals `horizon`, the winter one when it equals the summer one (or, without one,
    `horizon_winter`).

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
            low = lowest([horizon if p == pin else horizon_for(*p) for p in points])
            if low != horizon:
                record["horizon_low"] = pack_low(low)
            if winter_for is not None and winter is not None:
                low_winter = lowest([winter if p == pin else winter_for(*p) for p in points])
                same = (
                    pack_low(low_winter) == record["horizon_low"]
                    if "horizon_low" in record
                    else low_winter == winter
                )
                if not same:
                    record["horizon_low_winter"] = pack_low(low_winter)
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
    with HeightSampler(dsm_path, dtm_path) as sampler:
        return sampler.height(lat, lon)


class HeightSampler:
    """The surface and terrain models, open once to sample many points."""

    def __init__(self, dsm_path: Path, dtm_path: Path) -> None:
        self._stack = ExitStack()
        try:
            self._rasters = [
                (dataset, Transformer.from_crs("EPSG:4326", dataset.crs, always_xy=True))
                for dataset in (
                    self._stack.enter_context(rasterio.open(path)) for path in (dsm_path, dtm_path)
                )
            ]
        except BaseException:
            self._stack.close()
            raise

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self._stack.close()

    def height(self, lat: float, lon: float) -> float | None:
        values: list[float] = []
        for dataset, to_raster in self._rasters:
            x, y = to_raster.transform(lon, lat)
            left, bottom, right, top = dataset.bounds
            if not (left <= x < right and bottom < y <= top):
                return None
            value = float(next(dataset.sample([(x, y)]))[0])
            if dataset.nodata is not None and value == float(dataset.nodata):
                return None
            values.append(value)
        return values[0] - values[1]


def sample_grid(dsm_path: Path) -> SampleGrid:
    """The surface model's grid, whose cells the envelope samples."""
    with rasterio.open(dsm_path) as dataset:
        return SampleGrid(dataset.transform, dataset.crs.to_string())


def position_warnings(terraces: Sequence[Terrace], dsm_path: Path, dtm_path: Path) -> list[str]:
    """One message per terrace whose point sits on a roof or under a canopy."""
    warnings: list[str] = []
    with HeightSampler(dsm_path, dtm_path) as sampler:
        for t in terraces:
            if t.terrace is None:
                continue
            height = sampler.height(t.terrace.lat, t.terrace.lon)
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
        r'"(horizon|horizon_winter)": \[([^\]]*)\]',
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
    everywhere and the app uses `horizon` all year. `sun_corrections` count reports up to 365
    days before `generated` (default: now).
    """
    # Whole seconds, as the file writes it, so the window can be checked against the file.
    generated = (generated or datetime.now(UTC)).replace(microsecond=0)
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

    leafoff = leafoff_path if leafoff_path is not None and leafoff_path.exists() else None
    if leafoff is None:
        logger.info("no leaf-off surface model: horizon_winter stays null (ADR-0007)")

    structures = Structures(load_structures())
    carriageways = Carriageways(load_roads())
    grid = sample_grid(dsm_path)

    # The rasters stay open for every terrace: each takes a horizon and a height per sample point.
    with ExitStack() as stack:
        model = stack.enter_context(HorizonModel(dsm_path, dtm_path=dtm_path, leafoff_path=leafoff))
        heights = stack.enter_context(HeightSampler(dsm_path, dtm_path))
        # `add_horizons` asks for a point's leaf-off profile after its summer one; both come
        # from one ray trace (`HorizonModel.horizons`), the leaf-off one kept until asked for.
        pending: dict[LatLonPair, list[int]] = {}

        def summer_for(lat: float, lon: float) -> list[int]:
            summer, winter = model.horizons(lat, lon)
            if winter is not None:
                pending[(lat, lon)] = winter
            return summer

        def winter_for(lat: float, lon: float) -> list[int]:
            winter = pending.pop((lat, lon), None)
            if winter is None:
                winter = model.horizons(lat, lon)[1]
            if winter is None:
                raise ValueError("no leaf-off surface model")
            return winter

        def points_for(lat: float, lon: float) -> list[LatLonPair]:
            return terrace_points(
                lat, lon, grid, heights.height, structures.contains, carriageways.contains
            )

        terraces = add_horizons(
            terraces, summer_for, None if leafoff is None else winter_for, points_for
        )
    logger.info(
        "%d terraces get a sun envelope, %d a leaf-off one",
        sum(t.horizon_low is not None for t in terraces),
        sum(t.horizon_low_winter is not None for t in terraces),
    )
    if leafoff is not None:
        logger.info(
            "%d terraces get a winter horizon (bare deciduous trees)",
            sum(t.horizon_winter is not None for t in terraces),
        )
    reports = read_sun_reports()
    known = {t.id: t.horizon is not None for t in terraces}
    sun = sun_corrections_by_venue(reports, known, generated)
    shade = sun_corrections_by_venue(reports, known, generated, kind="shade")
    terraces = [
        t.model_copy(
            update={
                **({"sun_corrections": sun[t.id]} if t.id in sun else {}),
                **({"shade_corrections": shade[t.id]} if t.id in shade else {}),
            }
        )
        if t.id in sun or t.id in shade
        else t
        for t in terraces
    ]
    logger.info("%d terraces get sun corrections from accepted reports", len(sun))
    logger.info("%d terraces get shade corrections from accepted reports", len(shade))
    return TerracesFile(
        generated=generated,
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

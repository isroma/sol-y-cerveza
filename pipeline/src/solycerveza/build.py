"""Assemble `web/public/data/terraces.json` (see docs/data-contract.md) from every pipeline stage.

1. Base terrace records: OSM venues plus the curated list (`solycerveza.terraces`).
2. Surface and terrain rasters: run `python -m solycerveza.obstacles` once beforehand.
3. One horizon profile per terrace (`solycerveza.horizon`).

Run `python -m solycerveza.build [--refresh]` from `pipeline/`. `--refresh` re-downloads the
venues from Overpass instead of using the cache.
"""

import argparse
import json
import logging
import re
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

import rasterio
from pydantic import BaseModel, ConfigDict, field_serializer

from solycerveza.horizon import terrace_horizon
from solycerveza.terraces import Terrace, build_terraces, read_curated
from solycerveza.venues import CACHE_DIR, load_venues

logger = logging.getLogger(__name__)

OUTPUT = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terraces.json"
DSM_PATH = CACHE_DIR / "badajoz_dsm.tif"
DTM_PATH = CACHE_DIR / "badajoz_dtm.tif"
OSM_ATTRIBUTION = "© OpenStreetMap contributors (ODbL)"

HorizonFn = Callable[[float, float], list[int]]


class TerracesFile(BaseModel):
    """The whole file, mirroring `TerracesFile` in docs/data-contract.md (field order included)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    version: Literal[1] = 1
    generated: datetime
    sample: bool
    attribution: list[str]
    terraces: list[Terrace]

    @field_serializer("generated")
    def _utc_z(self, value: datetime) -> str:
        return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def add_horizons(terraces: Sequence[Terrace], horizon_for: HorizonFn) -> list[Terrace]:
    """Return copies of `terraces` with `horizon` computed at each terrace position.

    Re-validates every record, so a malformed profile fails here rather than in the app.
    """
    return [
        Terrace.model_validate(
            {**t.model_dump(), "horizon": horizon_for(t.terrace.lat, t.terrace.lon)}
        )
        for t in terraces
    ]


def raster_attribution(path: Path) -> str:
    """The attribution line `solycerveza.obstacles` stored in the raster's SOURCE tag."""
    with rasterio.open(path) as dataset:
        source = dataset.tags().get("SOURCE")
    if not source:
        raise ValueError(f"{path} has no SOURCE tag; rebuild it with solycerveza.obstacles")
    return str(source)


def render(file: TerracesFile) -> str:
    """Serialize per the contract: 2-space indent, each horizon on one line, trailing newline."""
    text = json.dumps(file.model_dump(mode="json"), ensure_ascii=False, indent=2)
    text = re.sub(
        r'"horizon": \[([^\]]*)\]',
        lambda m: '"horizon": [' + re.sub(r"\s+", "", m.group(1)) + "]",
        text,
    )
    return text + "\n"


def build(
    *,
    refresh: bool = False,
    dsm_path: Path = DSM_PATH,
    dtm_path: Path = DTM_PATH,
    generated: datetime | None = None,
) -> TerracesFile:
    """Run every stage and return the file contents."""
    terraces = build_terraces(load_venues(refresh=refresh), read_curated())

    def horizon_for(lat: float, lon: float) -> list[int]:
        return terrace_horizon(lat, lon, dsm_path, dtm_path=dtm_path)

    return TerracesFile(
        generated=generated or datetime.now(UTC),
        sample=False,
        attribution=[
            OSM_ATTRIBUTION,
            raster_attribution(dsm_path),
            raster_attribution(dtm_path),
        ],
        terraces=add_horizons(terraces, horizon_for),
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

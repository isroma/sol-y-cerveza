"""Horizon and height above ground at one point, for the admin's sun preview.

Run ``python -m solycerveza.probe --lat 38.8789 --lon -6.9707`` from ``pipeline/``. It prints one
JSON object on stdout and exits 0::

    {"horizon": [...360 ints...], "horizon_winter": null, "horizon_low": "#$%...",
     "height_above_ground": 0.42, "max_height_above_ground": 2.0}

``horizon`` is the profile ``solycerveza.build`` would store for a terrace there (tenths of a
degree, see ``docs/data-contract.md``). ``horizon_low`` is the envelope the build would store
(``solycerveza.envelope``, packed): the lowest obstacle over the ground points within 7 m, off the
road; null when no point is on open ground or it equals ``horizon``. The app answers from it when
present, so the admin's preview does too. ``horizon_winter`` is the leaf-off profile the build would
store (ADR-0007): null when it equals ``horizon`` or there is no leaf-off surface model (written by
``python -m solycerveza.leafoff``). ``height_above_ground`` is surface minus terrain at the
point in metres (null where a raster has no data), and ``max_height_above_ground`` is the build's
threshold above which a terrace point is flagged as on a roof or under a canopy.

On failure it prints ``{"error": "..."}`` and exits non-zero: 2 when the rasters are missing (the
object then also has ``"missing_rasters": true``), 1 for any other problem with the input.

``--dsm``, ``--dtm`` and ``--dsm-leafoff`` override the raster paths (the defaults are the
``.cache/`` files written by ``python -m solycerveza.obstacles`` and ``solycerveza.leafoff``), and
``--cache-dir`` the folder of the cached OSM structures and roads (downloaded there if missing,
as the build does).
"""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TextIO

from solycerveza.build import (
    DSM_PATH,
    DTM_PATH,
    MAX_HEIGHT_ABOVE_GROUND_M,
    HeightSampler,
    sample_grid,
)
from solycerveza.envelope import Structures, lowest, pack_low, terrace_points
from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.horizon import HorizonModel, terrace_horizon
from solycerveza.leafoff import LEAFOFF_DSM_PATH, load_structures
from solycerveza.roads import Carriageways, load_roads
from solycerveza.venues import CACHE_DIR

MISSING_RASTERS = (
    "LiDAR rasters not found: run `uv run python -m solycerveza.obstacles` in pipeline/"
)
# Height in the output is rounded to centimetres, so the JSON stays short and stable.
HEIGHT_DECIMALS = 2

type ProbeResult = dict[str, list[int] | str | float | None]


def probe(
    lat: float,
    lon: float,
    dsm_path: Path,
    dtm_path: Path,
    leafoff_path: Path | None = None,
    *,
    structures: Structures | None = None,
    carriageways: Carriageways | None = None,
    cache_dir: Path = CACHE_DIR,
) -> ProbeResult:
    """Horizon profiles, the envelope and height above ground at WGS84 ``(lat, lon)``.

    ``horizon_winter`` is computed only if ``leafoff_path`` is given and exists. ``structures``
    and ``carriageways`` default to the OSM ones cached in ``cache_dir`` (``load_structures``,
    ``load_roads``).

    Raises:
        ValueError: If the point is outside Badajoz or the rasters, or the terrain model has no
            data under it.
    """
    bbox = BADAJOZ_BBOX
    if not (bbox.south <= lat <= bbox.north and bbox.west <= lon <= bbox.east):
        raise ValueError(f"({lat}, {lon}) is outside the Badajoz bounding box")
    horizon = terrace_horizon(lat, lon, dsm_path, dtm_path=dtm_path)
    winter = None
    if leafoff_path is not None and leafoff_path.exists():
        winter = terrace_horizon(lat, lon, leafoff_path, dtm_path=dtm_path)
    if structures is None:
        structures = Structures(load_structures(cache_dir=cache_dir))
    if carriageways is None:
        carriageways = Carriageways(load_roads(cache_dir=cache_dir))
    with (
        HeightSampler(dsm_path, dtm_path) as heights,
        HorizonModel(dsm_path, dtm_path=dtm_path) as model,
    ):
        height = heights.height(lat, lon)
        points = terrace_points(
            lat,
            lon,
            sample_grid(dsm_path),
            heights.height,
            structures.contains,
            carriageways.contains,
        )
        low = (
            lowest([horizon if p == (lat, lon) else model.horizon(*p) for p in points])
            if points
            else None
        )
    return {
        "horizon": horizon,
        "horizon_winter": None if winter == horizon else winter,
        "horizon_low": None if low is None or low == horizon else pack_low(low),
        "height_above_ground": None if height is None else round(height, HEIGHT_DECIMALS),
        "max_height_above_ground": MAX_HEIGHT_ABOVE_GROUND_M,
    }


def main(argv: Sequence[str] | None = None, out: TextIO | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Print the horizon, envelope and height above ground at one point as JSON."
    )
    parser.add_argument("--lat", type=float, required=True, help="WGS84 latitude, degrees")
    parser.add_argument("--lon", type=float, required=True, help="WGS84 longitude, degrees")
    parser.add_argument("--dsm", type=Path, default=DSM_PATH, help="surface model GeoTIFF")
    parser.add_argument("--dtm", type=Path, default=DTM_PATH, help="terrain model GeoTIFF")
    parser.add_argument(
        "--dsm-leafoff",
        type=Path,
        default=LEAFOFF_DSM_PATH,
        help="leaf-off surface model GeoTIFF (optional)",
    )
    parser.add_argument(
        "--cache-dir", type=Path, default=CACHE_DIR, help="folder of the cached OSM downloads"
    )
    args = parser.parse_args(argv)
    stream = sys.stdout if out is None else out

    def emit(payload: object) -> None:
        stream.write(json.dumps(payload, separators=(",", ":")) + "\n")

    if not (args.dsm.exists() and args.dtm.exists()):
        emit({"error": MISSING_RASTERS, "missing_rasters": True})
        return 2
    try:
        result = probe(
            args.lat, args.lon, args.dsm, args.dtm, args.dsm_leafoff, cache_dir=args.cache_dir
        )
    except ValueError as error:
        emit({"error": str(error)})
        return 1
    emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

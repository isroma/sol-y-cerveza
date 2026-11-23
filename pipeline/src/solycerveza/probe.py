"""Horizon and height above ground at one point, for the admin's sun preview.

Run ``python -m solycerveza.probe --lat 38.8789 --lon -6.9707`` from ``pipeline/``. It prints one
JSON object on stdout and exits 0::

    {"horizon": [...360 ints...], "horizon_winter": null, "height_above_ground": 0.42,
     "max_height_above_ground": 2.0}

``horizon`` is the profile ``solycerveza.build`` would store for a terrace there (tenths of a
degree, see ``docs/data-contract.md``). ``horizon_winter`` is the leaf-off profile the build would
store (ADR-0007): null when it equals ``horizon`` or there is no leaf-off surface model (written by
``python -m solycerveza.leafoff``). ``height_above_ground`` is surface minus terrain at the
point in metres (null where a raster has no data), and ``max_height_above_ground`` is the build's
threshold above which a terrace point is flagged as on a roof or under a canopy.

On failure it prints ``{"error": "..."}`` and exits non-zero: 2 when the rasters are missing (the
object then also has ``"missing_rasters": true``), 1 for any other problem with the input.

``--dsm``, ``--dtm`` and ``--dsm-leafoff`` override the raster paths (the defaults are the
``.cache/`` files written by ``python -m solycerveza.obstacles`` and ``solycerveza.leafoff``).
"""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TextIO

from solycerveza.build import DSM_PATH, DTM_PATH, MAX_HEIGHT_ABOVE_GROUND_M, height_above_ground
from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.horizon import terrace_horizon
from solycerveza.leafoff import LEAFOFF_DSM_PATH

MISSING_RASTERS = (
    "LiDAR rasters not found: run `uv run python -m solycerveza.obstacles` in pipeline/"
)
# Height in the output is rounded to centimetres, so the JSON stays short and stable.
HEIGHT_DECIMALS = 2

type ProbeResult = dict[str, list[int] | float | None]


def probe(
    lat: float, lon: float, dsm_path: Path, dtm_path: Path, leafoff_path: Path | None = None
) -> ProbeResult:
    """Horizon profiles and height above ground at WGS84 ``(lat, lon)``.

    ``horizon_winter`` is computed only if ``leafoff_path`` is given and exists.

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
    height = height_above_ground(lat, lon, dsm_path, dtm_path)
    return {
        "horizon": horizon,
        "horizon_winter": None if winter == horizon else winter,
        "height_above_ground": None if height is None else round(height, HEIGHT_DECIMALS),
        "max_height_above_ground": MAX_HEIGHT_ABOVE_GROUND_M,
    }


def main(argv: Sequence[str] | None = None, out: TextIO | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Print the horizon and height above ground at one point as JSON."
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
    args = parser.parse_args(argv)
    stream = sys.stdout if out is None else out

    def emit(payload: object) -> None:
        stream.write(json.dumps(payload, separators=(",", ":")) + "\n")

    if not (args.dsm.exists() and args.dtm.exists()):
        emit({"error": MISSING_RASTERS, "missing_rasters": True})
        return 2
    try:
        result = probe(args.lat, args.lon, args.dsm, args.dtm, args.dsm_leafoff)
    except ValueError as error:
        emit({"error": str(error)})
        return 1
    emit(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

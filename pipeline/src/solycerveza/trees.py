"""Individual trees near the terraces, found in the LiDAR surface model.

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.trees

The surface model (DSM) includes tree crowns and roofs; the terrain model (DTM) is the ground.
Their difference is the height above ground. A tree is a local peak of it that drops on every
side, like a crown: flat roofs and roof ridges don't, so they are left out without needing
building outlines. Only trees within ``RADIUS_M`` of a terrace are kept, the ones that shade
terraces and show up in the 3D view around them.

Writes ``web/public/data/trees.json``::

    {"version": 1, "attribution": [...], "trees": [[lon, lat, height_m, crown_radius_m], ...]}

sorted by longitude then latitude, with fixed rounding, so diffs stay reviewable. The crown
radius is an estimate from the height, for drawing only.
"""

import argparse
import json
import logging
from collections.abc import Iterator, Sequence
from pathlib import Path

import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from pyproj import Transformer

from solycerveza.obstacles import CACHE_DIR, MDS02_ATTRIBUTION, MDT02_ATTRIBUTION

logger = logging.getLogger(__name__)

DSM_PATH = CACHE_DIR / "badajoz_dsm.tif"
DTM_PATH = CACHE_DIR / "badajoz_dtm.tif"
DATA_DIR = Path(__file__).resolve().parents[3] / "web" / "public" / "data"
TERRACES_JSON = DATA_DIR / "terraces.json"
TREES_JSON = DATA_DIR / "trees.json"

MIN_HEIGHT_M = 3.0
MAX_HEIGHT_M = 30.0
#: A peak must be the highest cell within this many cells (2 m grid: 6 m).
PEAK_CELLS = 3
#: Every cell on the ring this many cells out must be at least DROP_M lower: a crown.
RING_CELLS = 2
DROP_M = 0.5
#: Keep trees this close to a terrace.
RADIUS_M = 300.0
BLOCK_ROWS = 512

Grid = npt.NDArray[np.float64]


def find_peaks(height: Grid) -> list[tuple[int, int]]:
    """(row, col) of crown-shaped peaks in a height-above-ground grid (NaN = no data)."""
    h = np.where(np.isfinite(height), height, -np.inf)
    pad = max(PEAK_CELLS, RING_CELLS)
    padded = np.pad(h, pad, constant_values=-np.inf)
    window = np.lib.stride_tricks.sliding_window_view(padded, (2 * pad + 1, 2 * pad + 1))
    centre = h
    near = slice(pad - PEAK_CELLS, pad + PEAK_CELLS + 1)
    is_peak = centre >= window[:, :, near, near].max(axis=(2, 3))
    ring = _ring_mask(pad)
    ring_max = np.where(ring, window, -np.inf).max(axis=(2, 3))
    candidates = (
        is_peak
        & (centre >= MIN_HEIGHT_M)
        & (centre <= MAX_HEIGHT_M)
        & (ring_max <= centre - DROP_M)
        & np.isfinite(ring_max)
    )
    return [(int(r), int(c)) for r, c in np.argwhere(candidates)]


def _ring_mask(pad: int) -> npt.NDArray[np.bool_]:
    size = 2 * pad + 1
    y, x = np.mgrid[:size, :size] - pad
    ring: npt.NDArray[np.bool_] = np.maximum(np.abs(y), np.abs(x)) == RING_CELLS
    return ring


def crown_radius(height_m: float) -> float:
    """A drawing estimate of the crown radius from the tree height."""
    return min(6.0, max(1.5, 0.25 * height_m + 1.0))


def _blocks(rows: int) -> Iterator[tuple[int, int]]:
    for start in range(0, rows, BLOCK_ROWS):
        yield start, min(rows, start + BLOCK_ROWS)


def detect(
    dsm_path: Path, dtm_path: Path, near: Sequence[tuple[float, float]]
) -> list[tuple[float, float, float, float]]:
    """Trees as (lon, lat, height_m, crown_radius_m) within RADIUS_M of a `near` (lon, lat)."""
    with rasterio.open(dsm_path) as dsm, rasterio.open(dtm_path) as dtm:
        if dsm.shape != dtm.shape or dsm.transform != dtm.transform:
            raise ValueError("the DSM and DTM must share one grid")
        transform: Affine = dsm.transform
        to_grid = Transformer.from_crs("EPSG:4326", dsm.crs, always_xy=True)
        to_wgs = Transformer.from_crs(dsm.crs, "EPSG:4326", always_xy=True)
        anchors = np.array([to_grid.transform(lon, lat) for lon, lat in near])
        trees: list[tuple[float, float, float, float]] = []
        margin = max(PEAK_CELLS, RING_CELLS)
        for start, stop in _blocks(dsm.height):
            top = max(0, start - margin)
            bottom = min(dsm.height, stop + margin)
            window = ((top, bottom), (0, dsm.width))
            surface = dsm.read(1, window=window).astype(np.float64)
            ground = dtm.read(1, window=window).astype(np.float64)
            for nodata, grid in ((dsm.nodata, surface), (dtm.nodata, ground)):
                if nodata is not None:
                    grid[grid == nodata] = np.nan
            for row, col in find_peaks(surface - ground):
                if not start <= top + row < stop:
                    continue
                x, y = transform @ (col + 0.5, top + row + 0.5)
                if len(anchors) and np.hypot(*(anchors - (x, y)).T).min() > RADIUS_M:
                    continue
                height = float(surface[row, col] - ground[row, col])
                lon, lat = to_wgs.transform(x, y)
                trees.append(
                    (round(lon, 6), round(lat, 6), round(height, 1), round(crown_radius(height), 1))
                )
    return sorted(trees)


def terrace_positions(path: Path = TERRACES_JSON) -> list[tuple[float, float]]:
    records = json.loads(path.read_text(encoding="utf-8"))["terraces"]
    return [(r["terrace"]["lon"], r["terrace"]["lat"]) for r in records if r["terrace"]]


def render(trees: Sequence[tuple[float, float, float, float]]) -> str:
    rows = ",\n".join(f"    [{lon}, {lat}, {h}, {r}]" for lon, lat, h, r in trees)
    attribution = json.dumps([MDS02_ATTRIBUTION, MDT02_ATTRIBUTION], ensure_ascii=False)
    return (
        f'{{\n  "version": 1,\n  "attribution": {attribution},\n  "trees": [\n{rows}\n  ]\n}}\n'
        if trees
        else f'{{\n  "version": 1,\n  "attribution": {attribution},\n  "trees": []\n}}\n'
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write web/public/data/trees.json.")
    parser.add_argument("--dsm", type=Path, default=DSM_PATH)
    parser.add_argument("--dtm", type=Path, default=DTM_PATH)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    trees = detect(args.dsm, args.dtm, terrace_positions())
    TREES_JSON.write_text(render(trees), encoding="utf-8")
    logger.info("%d trees within %.0f m of a terrace -> %s", len(trees), RADIUS_M, TREES_JSON)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

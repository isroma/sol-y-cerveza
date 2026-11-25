"""Tree crowns for the map: what casts the GPU shadows' non-building shade, drawn in 3D.

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.trees [--out ../web/public/data/trees.json]

The GPU shadows (``web/src/map/heightShadows.ts``) march through the whole surface model, so
trees cast shade the basemap never draws. This finds them in the same model: cells at least
``MIN_HEIGHT_M`` above the terrain, away from every OSM building or structure
(``leafoff.load_structures``, buffered by ``BUILDING_BUFFER_CELLS``). Shapes narrower than
three cells (walls, fences, lamp posts, cables) are opened away. What is left is cut into height
bands (``BANDS_M``), and each band becomes smoothed polygons extruded from the band below it,
so a crown reads as a stepped dome. Each polygon's top is its own crown's height (95th percentile
of its cells), capped where the next band takes over, so no crown is drawn taller than it is.

Unmapped buildings, kiosks and awnings that pass the filters are drawn as trees too.

Output: a compact JSON (``encode``), decoded in the app's map workers by
``web/src/map/treeCodec.ts``; coordinates in WGS84 rounded to 1e-5 degrees (about 1 m),
ordered by band then position (deterministic).
"""

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import rasterize, shapes
from shapely.geometry import LinearRing, MultiPolygon, Polygon, shape

from solycerveza.leafoff import dilate, load_structures, structures_mask
from solycerveza.obstacles import Grid
from solycerveza.venues import CACHE_DIR

MIN_HEIGHT_M = 2.5
BUILDING_BUFFER_CELLS = 2  # 4 m: OSM outlines are often 1-3 m off the LiDAR
BANDS_M = (2.5, 7.0, 13.0)
SMOOTH_M = 1.5
SIMPLIFY_M = 1.5
MIN_AREA_M2 = 30.0
UNIT = 100_000  # coordinates in 1e-5 degrees, about 1 m
OUT_PATH = Path("../web/public/data/trees.json")

BoolArray = npt.NDArray[np.bool_]
FloatArray = npt.NDArray[np.float64]


def erode(mask: BoolArray, cells: int) -> BoolArray:
    """Shrink ``mask`` by ``cells`` in every direction (the inverse of ``leafoff.dilate``)."""
    return ~dilate(~mask, cells)


def opened(mask: BoolArray, cells: int = 1) -> BoolArray:
    """``mask`` without parts narrower than ``2 * cells + 1`` cells."""
    return dilate(erode(mask, cells), cells) & mask


def smoothed(values: FloatArray) -> FloatArray:
    """3 x 3 mean, edges padded with their own values."""
    padded = np.pad(values, 1, mode="edge")
    rows, cols = values.shape
    return np.asarray(
        sum(padded[i : i + rows, j : j + cols] for i in range(3) for j in range(3)) / 9.0
    )


def crown_cells(above_ground: FloatArray, structures: BoolArray) -> BoolArray:
    """Cells of tree crowns: tall enough, clear of structures, at least three cells wide."""
    candidate = np.isfinite(above_ground) & (above_ground >= MIN_HEIGHT_M)
    candidate &= ~dilate(structures, BUILDING_BUFFER_CELLS)
    return opened(candidate)


def band_polygons(
    crowns: BoolArray, heights: FloatArray, grid: Grid
) -> list[tuple[float, float, Polygon]]:
    """(base, top, polygon in grid CRS) for every band, bottom band first."""
    out: list[tuple[float, float, Polygon]] = []
    for index, low in enumerate(BANDS_M):
        above = BANDS_M[index + 1] if index + 1 < len(BANDS_M) else None
        mask = crowns & (heights >= low)
        if not mask.any():
            break
        base = 0.0 if index == 0 else BANDS_M[index - 1] + (low - BANDS_M[index - 1]) / 2
        for geom, top in band_shapes(mask, heights, grid, above):
            smooth = geom.buffer(SMOOTH_M).buffer(-SMOOTH_M).simplify(SIMPLIFY_M)
            parts = smooth.geoms if isinstance(smooth, MultiPolygon) else [smooth]
            for part in parts:
                if isinstance(part, Polygon) and part.area >= MIN_AREA_M2:
                    out.append((round(base, 1), float(round(max(top, low + 1.0))), part))
    return out


def band_shapes(
    mask: BoolArray, heights: FloatArray, grid: Grid, above: float | None
) -> list[tuple[Polygon, float]]:
    """Each connected shape of ``mask`` with its top: the crown's own height (95th percentile
    of its cells), up to ``above``, where the next band takes over."""
    geoms: list[Polygon] = []
    for geom, value in shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform):
        polygon = shape(geom)
        if value == 1 and isinstance(polygon, Polygon):
            geoms.append(polygon)
    if not geoms:
        return []
    labels = rasterize(
        ((geom, i + 1) for i, geom in enumerate(geoms)),
        out_shape=mask.shape,
        transform=grid.transform,
        dtype="int32",
    )
    labels[~mask] = 0
    flat = labels.ravel()
    order = np.argsort(flat, kind="stable")
    sorted_labels = flat[order]
    values = heights.ravel()[order]
    starts = np.searchsorted(sorted_labels, np.arange(1, len(geoms) + 2))
    out: list[tuple[Polygon, float]] = []
    for i, geom in enumerate(geoms):
        cells = values[starts[i] : starts[i + 1]]
        top = float(np.percentile(cells, 95)) if len(cells) else 0.0
        out.append((geom, min(top, above) if above is not None else top))
    return out


def encode(bands: Sequence[tuple[float, float, Polygon]], crs: str) -> dict[str, Any]:
    """The crowns in the compact format ``web/src/map/treeCodec.ts`` decodes.

    ``{"v": 1, "g": [[base, top, polygons], ...]}``, one group per (base, top), in order. A
    polygon is a list of rings; a ring is a flat list of ``x, y`` steps in ``UNIT`` degrees
    (WGS84), open (the closing point is implied). Each step is from the previous point, and a
    ring's first point is from the first point of the ring before it. Within a group, polygons
    are ordered by position, so the output is deterministic and the steps small.
    """
    to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    groups: dict[
        tuple[float, float], list[tuple[tuple[int, int], list[npt.NDArray[np.int64]]]]
    ] = {}
    for base, top, polygon in bands:
        geom = shapely.transform(
            polygon, lambda xy: np.column_stack(to_wgs84.transform(xy[:, 0], xy[:, 1]))
        )
        rings = [
            ring for ring in map(grid_ring, [geom.exterior, *geom.interiors]) if ring is not None
        ]
        if not rings:
            continue
        point = geom.representative_point()
        key = (round(point.y * UNIT), round(point.x * UNIT))
        groups.setdefault((base, top), []).append((key, rings))
    out: list[list[Any]] = []
    first = np.zeros(2, dtype=np.int64)
    for (base, top), polygons in sorted(groups.items()):
        encoded: list[list[list[int]]] = []
        for _, rings in sorted(polygons, key=lambda item: item[0]):
            steps_per_ring: list[list[int]] = []
            for ring in rings:
                steps = np.diff(ring, axis=0, prepend=first[np.newaxis, :])
                first = ring[0]
                steps_per_ring.append([int(v) for v in steps.ravel()])
            encoded.append(steps_per_ring)
        out.append([base, top, encoded])
    return {"v": 1, "g": out}


def grid_ring(ring: LinearRing) -> npt.NDArray[np.int64] | None:
    """A ring's points in whole ``UNIT`` degrees, open, without repeats; None if it collapses."""
    points = np.rint(np.asarray(ring.coords)[:-1] * UNIT).astype(np.int64)
    keep = np.any(points != np.roll(points, 1, axis=0), axis=1)
    points = points[keep]
    return points if len(points) >= 3 else None


def build(dsm_path: Path, dtm_path: Path, cache_dir: Path) -> dict[str, Any]:
    with rasterio.open(dsm_path) as dsm, rasterio.open(dtm_path) as dtm:
        grid = Grid(dsm.crs.to_string(), dsm.transform, dsm.width, dsm.height)
        surface = dsm.read(1).astype(np.float64)
        terrain = dtm.read(1).astype(np.float64)
        for data, nodata in ((surface, dsm.nodata), (terrain, dtm.nodata)):
            if nodata is not None:
                data[data == nodata] = np.nan
    heights = smoothed(surface - terrain)
    structures = structures_mask(load_structures(cache_dir=cache_dir), grid)
    crowns = crown_cells(heights, structures)
    return encode(band_polygons(crowns, heights, grid), grid.crs)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--cache", type=Path, default=CACHE_DIR)
    args = parser.parse_args(argv)
    crowns = build(args.cache / "badajoz_dsm.tif", args.cache / "badajoz_dtm.tif", args.cache)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(crowns, separators=(",", ":")) + "\n", encoding="utf-8")
    count = sum(len(polygons) for _, _, polygons in crowns["g"])
    print(f"wrote {count} crown polygons to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

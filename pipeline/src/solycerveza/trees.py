"""Tree crowns for the map: what casts the GPU shadows' non-building shade, drawn in 3D.

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.trees [--out ../web/public/data/trees.json]

The GPU shadows (``web/src/map/heightShadows.ts``) march through the whole surface model, so
trees cast shade the basemap never draws. This finds them in the same model: cells at least
``MIN_HEIGHT_M`` above the terrain, away from every OSM building or structure
(``leafoff.load_structures``, buffered by ``BUILDING_BUFFER_CELLS``). Shapes narrower than
three cells (walls, fences, lamp posts, cables) are opened away. What is left is cut into height
bands (``BANDS_M``), and each band becomes smoothed polygons extruded from the band below it,
so a crown reads as a stepped dome.

Unmapped buildings, kiosks and awnings that pass the filters are drawn as trees too.

Output: a GeoJSON FeatureCollection, each feature with ``b`` (base, m) and ``h`` (top, m),
coordinates in WGS84 rounded to 5 decimals (about 1 m), ordered by band then position
(deterministic).
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
from rasterio.features import shapes
from shapely.geometry import MultiPolygon, Polygon, shape

from solycerveza.leafoff import dilate, load_structures, structures_mask
from solycerveza.obstacles import Grid
from solycerveza.venues import CACHE_DIR

MIN_HEIGHT_M = 2.5
BUILDING_BUFFER_CELLS = 2  # 4 m: OSM outlines are often 1-3 m off the LiDAR
BANDS_M = (2.5, 6.0, 11.0, 17.0)
SMOOTH_M = 1.5
SIMPLIFY_M = 1.0
MIN_AREA_M2 = 16.0
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
        top = BANDS_M[index + 1] if index + 1 < len(BANDS_M) else float(np.nanmax(heights))
        mask = crowns & (heights >= low)
        if not mask.any():
            break
        geoms = [
            shape(geom)
            for geom, value in shapes(mask.astype(np.uint8), mask=mask, transform=grid.transform)
            if value == 1
        ]
        base = 0.0 if index == 0 else BANDS_M[index - 1] + (low - BANDS_M[index - 1]) / 2
        for geom in geoms:
            smooth = geom.buffer(SMOOTH_M).buffer(-SMOOTH_M).simplify(SIMPLIFY_M)
            parts = smooth.geoms if isinstance(smooth, MultiPolygon) else [smooth]
            for part in parts:
                if isinstance(part, Polygon) and part.area >= MIN_AREA_M2:
                    out.append((round(base, 1), round(max(top, low + 1.0), 1), part))
    return out


def feature_collection(bands: Sequence[tuple[float, float, Polygon]], crs: str) -> dict[str, Any]:
    """GeoJSON in WGS84, coordinates rounded, ordered by band and then by position."""
    to_wgs84 = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    features: list[tuple[tuple[float, float, float], dict[str, Any]]] = []
    for base, top, polygon in bands:
        geom = shapely.transform(
            polygon, lambda xy: np.column_stack(to_wgs84.transform(xy[:, 0], xy[:, 1]))
        )
        rings = [geom.exterior.coords, *(ring.coords for ring in geom.interiors)]
        coordinates = [[[round(x, 5), round(y, 5)] for x, y in ring] for ring in rings]
        point = geom.representative_point()
        features.append(
            (
                (base, round(point.y, 6), round(point.x, 6)),
                {
                    "type": "Feature",
                    "properties": {"b": base, "h": top},
                    "geometry": {"type": "Polygon", "coordinates": coordinates},
                },
            )
        )
    features.sort(key=lambda item: item[0])
    return {"type": "FeatureCollection", "features": [f for _, f in features]}


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
    return feature_collection(band_polygons(crowns, heights, grid), grid.crs)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--cache", type=Path, default=CACHE_DIR)
    args = parser.parse_args(argv)
    collection = build(args.cache / "badajoz_dsm.tif", args.cache / "badajoz_dtm.tif", args.cache)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(collection, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(collection['features'])} crown polygons to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

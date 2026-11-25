"""Height tiles for the map's sun shadows: the surface and terrain models as Web Mercator PNGs.

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.heightmap [--out ../web/public/data/heights]

The map draws shadows by marching from each ground pixel towards the sun through these heights,
the same surface model the terrace horizons come from, so trees and terrain cast shadows too.

Tiles are ``TILE_PX`` pixels at zoom ``ZOOM`` (about 1.9 m per pixel in Badajoz, close to the
2 m LiDAR grid), written as ``{out}/{x}/{y}.png``. Each pixel encodes:

- R, G: the surface (DSM) elevation in decimetres, as a big-endian 16-bit integer; 0 = no data.
- B: the surface's height above the terrain (DSM - DTM) in quarter metres, capped at 255.
"""

import argparse
import math
import sys
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from rasterio.warp import Resampling, reproject

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox
from solycerveza.venues import CACHE_DIR

ZOOM = 15
TILE_PX = 512
WORLD_M = 2 * math.pi * 6378137.0
OUT_DIR = Path("../web/public/data/heights")


def tile_range(bbox: BoundingBox, zoom: int = ZOOM) -> tuple[range, range]:
    """The x and y tile indexes covering ``bbox``."""
    n = 2**zoom

    def tx(lon: float) -> int:
        return math.floor((lon + 180) / 360 * n)

    def ty(lat: float) -> int:
        r = math.radians(lat)
        return math.floor((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)

    return range(tx(bbox.west), tx(bbox.east) + 1), range(ty(bbox.north), ty(bbox.south) + 1)


def tile_transform(x: int, y: int, zoom: int = ZOOM) -> Affine:
    """Pixel to EPSG:3857 metres for tile ``(x, y)``."""
    size = WORLD_M / 2**zoom
    return Affine(size / TILE_PX, 0, -WORLD_M / 2 + x * size, 0, -size / TILE_PX, WORLD_M / 2 - y * size)


def encode(dsm: npt.NDArray[np.float64], dtm: npt.NDArray[np.float64]) -> npt.NDArray[np.uint8]:
    """RGB pixels for a tile (see the module docstring)."""
    valid = np.isfinite(dsm) & np.isfinite(dtm) & (dsm > 0)
    decimetres = np.where(valid, np.clip(np.round(dsm * 10), 1, 65535), 0).astype(np.uint16)
    above = np.where(valid, np.clip(np.round((dsm - dtm) * 4), 0, 255), 0).astype(np.uint8)
    rgb = np.zeros((*dsm.shape, 3), dtype=np.uint8)
    rgb[..., 0] = decimetres >> 8
    rgb[..., 1] = decimetres & 0xFF
    rgb[..., 2] = above
    return rgb


def _warp(path: Path, transform: Affine) -> npt.NDArray[np.float64]:
    out = np.full((TILE_PX, TILE_PX), np.nan)
    with rasterio.open(path) as src:
        reproject(
            source=rasterio.band(src, 1),
            destination=out,
            dst_transform=transform,
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.nearest,
        )
    return out


def build_tiles(dsm_path: Path, dtm_path: Path, out_dir: Path, bbox: BoundingBox = BADAJOZ_BBOX) -> int:
    """Write every tile covering ``bbox`` that has data. Returns how many were written."""
    xs, ys = tile_range(bbox)
    written = 0
    for x in xs:
        for y in ys:
            transform = tile_transform(x, y)
            dsm = _warp(dsm_path, transform)
            if not np.isfinite(dsm).any():
                continue
            rgb = encode(dsm, _warp(dtm_path, transform))
            path = out_dir / str(x) / f"{y}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            with rasterio.open(
                path, "w", driver="PNG", width=TILE_PX, height=TILE_PX, count=3, dtype="uint8", ZLEVEL=9
            ) as dst:
                dst.write(np.moveaxis(rgb, -1, 0))
            written += 1
    return written


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_DIR)
    parser.add_argument("--cache", type=Path, default=CACHE_DIR)
    args = parser.parse_args(argv)
    count = build_tiles(args.cache / "badajoz_dsm.tif", args.cache / "badajoz_dtm.tif", args.out)
    print(f"wrote {count} tiles to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

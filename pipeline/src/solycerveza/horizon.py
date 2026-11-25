"""Per-terrace horizon profiles from a surface model (``docs/data-contract.md``, "Horizon").

``horizon_profile`` is the pure core: it ray-marches a surface-model array in a projected metric
CRS. ``terrace_horizon`` wraps it for the pipeline: WGS84 input, GeoTIFF input, and only a
±300 m window of the surface model read per terrace.

Sampling choices:

- Rays advance in steps of half a pixel and take the value of the cell they land in (nearest
  neighbour), so building edges stay sharp. The angle uses the distance of the sample itself, so
  an obstacle can read up to half a pixel farther away than it is.
- Each 1° bin is sampled by several sub-rays spread evenly inside ``[i - 0.5°, i + 0.5°)``, and
  the bin keeps the highest angle. There are enough of them for the gap between neighbouring
  sub-rays at 300 m to stay within one pixel (3 per bin on a 2 m grid), so a one-pixel pole or
  a thin tree crown between two bin centres is not missed.
- A ray stops when it leaves the raster. Nodata cells are skipped without stopping the ray.
- The observer's own cell is skipped: the observer stands on the ground there, and a surface
  model can put an awning, a crown or a roof edge in that cell, which would read as a ~90° wall
  in every direction.
- Azimuths are compass azimuths from true north, as the client's sun position is. Grid north of
  a UTM raster differs by the meridian convergence (about 1.3° in Badajoz on EPSG:25829), which
  ``terrace_horizon`` passes to the core as ``true_north_bearing``.
- Earth curvature and refraction are ignored: within 300 m they move a point by under 1 cm.
"""

import math
from pathlib import Path
from typing import Any, Self

import numpy as np
import rasterio
from affine import Affine
from numpy.typing import NDArray
from pyproj import CRS, Transformer
from rasterio.io import DatasetReader
from rasterio.windows import Window

EYE_HEIGHT_M = 1.2
MAX_DISTANCE_M = 300.0
BINS = 360
MAX_TENTHS = 900

_WGS84 = CRS.from_epsg(4326)


def horizon_profile(
    surface: NDArray[np.floating[Any]],
    transform: Affine,
    x: float,
    y: float,
    ground_elevation: float,
    *,
    nodata: float | None = None,
    true_north_bearing: float = 0.0,
) -> list[int]:
    """Horizon profile of the observer at ``(x, y)`` on a surface model.

    Args:
        surface: 2-D surface model (buildings, trees, terrain), elevations in metres.
        transform: Affine transform of ``surface`` (pixel to CRS), in a projected metric CRS.
        x: Observer easting in the raster's CRS, in metres.
        y: Observer northing in the raster's CRS, in metres.
        ground_elevation: Ground elevation at the observer, in metres. The eye sits
            ``EYE_HEIGHT_M`` above it.
        nodata: Cells with this value are ignored. NaN cells are always ignored.
        true_north_bearing: Direction of true north, in degrees clockwise from grid north
            (``+y``). Zero treats grid north as true north.

    Returns:
        ``BINS`` integers: the highest obstacle elevation angle per 1° azimuth bin, in tenths of
        a degree, from 0 to ``MAX_TENTHS``. Index 0 is north, clockwise.

    Raises:
        ValueError: If ``surface`` is not 2-D, the observer is outside it, or the ground
            elevation is not finite.
    """
    if surface.ndim != 2:
        raise ValueError(f"surface must be 2-D, got {surface.ndim} dimensions")
    if not math.isfinite(ground_elevation):
        raise ValueError(f"ground elevation must be finite, got {ground_elevation}")
    height, width = surface.shape
    inverse = ~transform
    col0, row0 = inverse @ (x, y)
    own_col, own_row = math.floor(col0), math.floor(row0)
    if not (0 <= own_col < width and 0 <= own_row < height):
        raise ValueError(f"observer ({x}, {y}) is outside the raster")

    east, north, distances = _ray_offsets(transform, true_north_bearing)
    cols = _cells(col0, inverse.a, east, inverse.b, north)
    rows = _cells(row0, inverse.d, east, inverse.e, north)

    # Rays start inside the raster, which is convex: once a sample is outside, the rest of the
    # ray is too, so masking out-of-raster samples is the same as stopping the ray there.
    # As unsigned, a negative index is huge, so one comparison per axis covers both edges.
    inside = (cols.view(np.uintp) < width) & (rows.view(np.uintp) < height)
    flat = rows * width
    flat += cols
    flat[~inside] = 0
    z = surface.reshape(-1)[flat].astype(np.float64, copy=False)
    valid = inside & np.isfinite(z) & ((rows != own_row) | (cols != own_col))
    if nodata is not None:
        valid &= z != nodata

    # max(tan) per bin gives the max angle, and a floor of 0 clamps the ground dropping away.
    # In place on `z` (indexing made it a copy), in the order (z - (ground + eye)) / distance.
    z -= ground_elevation + EYE_HEIGHT_M
    z /= distances
    tangents = np.where(valid, z, 0.0)
    best = np.maximum(tangents.max(axis=(1, 2)), 0.0)
    tenths = np.clip(np.rint(np.degrees(np.arctan(best)) * 10), 0, MAX_TENTHS)
    return [int(value) for value in tenths]


def _cells(
    origin: float,
    along_east: float,
    east: NDArray[np.floating[Any]],
    along_north: float,
    north: NDArray[np.floating[Any]],
) -> NDArray[np.intp]:
    """``floor(origin + along_east * east + along_north * north)`` as cell indices.

    Evaluated in that order, in place; a zero coefficient (a north-up raster) adds only ±0,
    which changes no value, so its term is skipped.
    """
    position = east * along_east
    position += origin
    if along_north != 0.0:
        position += along_north * north
    np.floor(position, out=position)
    return position.astype(np.intp)


def _ray_offsets(
    transform: Affine, true_north_bearing: float
) -> tuple[NDArray[np.floating[Any]], NDArray[np.floating[Any]], NDArray[np.floating[Any]]]:
    """Sample offsets from the observer, in CRS metres, shaped ``(bins, rays per bin, steps)``.

    Also returns the distance of each step, shaped ``(steps,)``.
    """
    pixel = min(math.hypot(transform.a, transform.d), math.hypot(transform.b, transform.e))
    step = pixel / 2
    distances = step * np.arange(1, math.floor(MAX_DISTANCE_M / step) + 1)
    rays_per_bin = max(1, math.ceil(MAX_DISTANCE_M * math.radians(1.0) / pixel))
    spread = (np.arange(rays_per_bin) + 0.5) / rays_per_bin - 0.5
    bearings = np.radians(np.arange(BINS)[:, None] + spread[None, :] + true_north_bearing)
    east = np.sin(bearings)[:, :, None] * distances
    north = np.cos(bearings)[:, :, None] * distances
    return east, north, distances


def terrace_horizon(
    lat: float,
    lon: float,
    dsm_path: Path,
    *,
    dtm_path: Path | None = None,
    ground_elevation: float | None = None,
) -> list[int]:
    """Horizon profile of a terrace at WGS84 ``(lat, lon)``.

    Reads only the part of the surface model within ``MAX_DISTANCE_M`` of the terrace. For many
    terraces, use ``HorizonModel``, which opens the rasters once.

    Args:
        lat: Terrace latitude, WGS84 degrees.
        lon: Terrace longitude, WGS84 degrees.
        dsm_path: Surface model GeoTIFF (band 1, metres) in a projected metric CRS.
        dtm_path: Terrain model GeoTIFF (band 1, metres) in a projected metric CRS. The ground
            elevation is the value of the cell under the terrace. Give this or
            ``ground_elevation``.
        ground_elevation: Ground elevation at the terrace, in metres.

    Returns:
        The profile described in ``horizon_profile``.

    Raises:
        ValueError: If not exactly one of ``dtm_path`` and ``ground_elevation`` is given, a
            raster is not in a projected metric CRS, the terrace is outside a raster, or the
            terrain model has no data under it.
    """
    if (dtm_path is None) == (ground_elevation is None):
        raise ValueError("give exactly one of dtm_path and ground_elevation")
    with HorizonModel(dsm_path, dtm_path=dtm_path) as model:
        return model.horizon(lat, lon, ground_elevation=ground_elevation)


class HorizonModel:
    """Open surface (and terrain) models that give the horizon profile of many terraces.

    Opening a raster and setting up its WGS84 transformer cost far more than one profile, so the
    build opens them once for all terraces. Use it as a context manager, or call ``close``.

    Args:
        dsm_path: Surface model GeoTIFF (band 1, metres) in a projected metric CRS.
        dtm_path: Terrain model GeoTIFF (band 1, metres) in a projected metric CRS, for the
            ground elevation under each terrace. Without it, ``horizon`` needs
            ``ground_elevation``.
    """

    def __init__(self, dsm_path: Path, *, dtm_path: Path | None = None) -> None:
        self._dtm = None if dtm_path is None else _Raster(dtm_path)
        try:
            self._dsm = _Raster(dsm_path)
        except BaseException:
            if self._dtm is not None:
                self._dtm.close()
            raise

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        self._dsm.close()
        if self._dtm is not None:
            self._dtm.close()

    def horizon(
        self, lat: float, lon: float, *, ground_elevation: float | None = None
    ) -> list[int]:
        """Horizon profile of a terrace at WGS84 ``(lat, lon)``, as ``terrace_horizon``.

        The ground elevation comes from the terrain model unless ``ground_elevation`` is given.

        Raises:
            ValueError: If there is no ground elevation, a raster is not in a projected metric
                CRS, the terrace is outside a raster, or the terrain model has no data under it.
        """
        if ground_elevation is None:
            if self._dtm is None:
                raise ValueError("give exactly one of dtm_path and ground_elevation")
            ground_elevation = self._dtm.ground_elevation(lat, lon)

        dsm = self._dsm.dataset
        x, y, true_north_bearing = self._dsm.project(lat, lon)
        window = _window_around(dsm, x, y, MAX_DISTANCE_M)
        if window is None:
            raise ValueError(f"terrace ({lat}, {lon}) is outside {self._dsm.path}")
        surface = np.asarray(dsm.read(1, window=window), dtype=np.float64)
        transform: Affine = dsm.window_transform(window)
        nodata = None if dsm.nodata is None else float(dsm.nodata)

        return horizon_profile(
            surface,
            transform,
            x,
            y,
            ground_elevation,
            nodata=nodata,
            true_north_bearing=true_north_bearing,
        )


class _Raster:
    """An open raster and, once first needed, its transformer from WGS84."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.dataset: DatasetReader = rasterio.open(path)
        self._to_raster: Transformer | None = None

    def close(self) -> None:
        self.dataset.close()

    def project(self, lat: float, lon: float) -> tuple[float, float, float]:
        """Easting and northing of ``(lat, lon)`` in the raster's CRS, and the true-north
        bearing there, in degrees clockwise from grid north.

        Raises:
            ValueError: If the raster is not in a projected metric CRS.
        """
        if self._to_raster is None:
            crs = _metric_crs(self.dataset, self.path)
            self._to_raster = Transformer.from_crs(_WGS84, crs, always_xy=True)
        x, y = self._to_raster.transform(lon, lat)
        x_north, y_north = self._to_raster.transform(lon, lat + 1e-4)
        return float(x), float(y), math.degrees(math.atan2(x_north - x, y_north - y))

    def ground_elevation(self, lat: float, lon: float) -> float:
        dtm = self.dataset
        x, y, _ = self.project(lat, lon)
        col, row = ~dtm.transform @ (x, y)
        if not (0 <= col < dtm.width and 0 <= row < dtm.height):
            raise ValueError(f"terrace ({lat}, {lon}) is outside {self.path}")
        cell = Window(math.floor(col), math.floor(row), 1, 1)
        value = float(dtm.read(1, window=cell)[0, 0])
        if not math.isfinite(value) or (dtm.nodata is not None and value == dtm.nodata):
            raise ValueError(f"no terrain data at ({lat}, {lon}) in {self.path}")
        return value


def _metric_crs(dataset: DatasetReader, path: Path) -> CRS:
    if dataset.crs is None:
        raise ValueError(f"{path} has no CRS")
    crs = CRS.from_wkt(dataset.crs.to_wkt())
    if not crs.is_projected or any(axis.unit_name != "metre" for axis in crs.axis_info):
        raise ValueError(f"{path} must be in a projected CRS in metres, got {crs.name}")
    return crs


def _window_around(dataset: DatasetReader, x: float, y: float, radius: float) -> Window | None:
    """Whole-pixel window covering ``radius`` metres around ``(x, y)``, clipped to the raster.

    Returns ``None`` if ``(x, y)`` is outside the raster.
    """
    inverse = ~dataset.transform
    col, row = inverse @ (x, y)
    if not (0 <= col < dataset.width and 0 <= row < dataset.height):
        return None
    corners = [inverse @ (x + dx, y + dy) for dx in (-radius, radius) for dy in (-radius, radius)]
    col_off = max(0, math.floor(min(c for c, _ in corners)) - 1)
    row_off = max(0, math.floor(min(r for _, r in corners)) - 1)
    col_end = min(dataset.width, math.ceil(max(c for c, _ in corners)) + 1)
    row_end = min(dataset.height, math.ceil(max(r for _, r in corners)) + 1)
    return Window(col_off, row_off, col_end - col_off, row_end - row_off)

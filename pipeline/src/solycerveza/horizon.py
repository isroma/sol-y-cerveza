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
from collections.abc import Sequence
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
    (profile,) = horizon_profiles(
        [(surface, nodata)],
        transform,
        x,
        y,
        ground_elevation,
        true_north_bearing=true_north_bearing,
    )
    return profile


def horizon_profiles(
    surfaces: Sequence[tuple[NDArray[np.floating[Any]], float | None]],
    transform: Affine,
    x: float,
    y: float,
    ground_elevation: float,
    *,
    true_north_bearing: float = 0.0,
) -> list[list[int]]:
    """``horizon_profile`` of one observer on several surface models of the same grid.

    Each surface comes with its own nodata value. The rays are traced once for all of them, so
    the leaf-off profile at a point costs a fraction of the summer one (``HorizonModel``). Each
    profile is exactly what ``horizon_profile`` returns for that surface alone.
    """
    if not surfaces:
        return []
    shape = surfaces[0][0].shape
    for surface, _ in surfaces:
        if surface.ndim != 2:
            raise ValueError(f"surface must be 2-D, got {surface.ndim} dimensions")
        if surface.shape != shape:
            raise ValueError(f"surfaces must share one shape, got {surface.shape} and {shape}")
    if not math.isfinite(ground_elevation):
        raise ValueError(f"ground elevation must be finite, got {ground_elevation}")
    height, width = shape
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
    sampled = inside & ((rows != own_row) | (cols != own_col))
    eye = ground_elevation + EYE_HEIGHT_M

    profiles: list[list[int]] = []
    for surface, nodata in surfaces:
        z = surface.reshape(-1)[flat].astype(np.float64, copy=False)
        valid = sampled & np.isfinite(z)
        if nodata is not None:
            valid &= z != nodata
        # max(tan) per bin gives the max angle, and a floor of 0 clamps the ground dropping away.
        # In place on `z` (indexing made it a copy), in the order (z - (ground + eye)) / distance.
        z -= eye
        z /= distances
        tangents = np.where(valid, z, 0.0)
        best = np.maximum(tangents.max(axis=(1, 2)), 0.0)
        tenths = np.clip(np.rint(np.degrees(np.arctan(best)) * 10), 0, MAX_TENTHS)
        profiles.append([int(value) for value in tenths])
    return profiles


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
        leafoff_path: Leaf-off surface model GeoTIFF (ADR-0007), for ``horizons``. On the
            surface model's grid (as ``solycerveza.leafoff`` writes it), both profiles of a
            point share one ray trace.
    """

    def __init__(
        self, dsm_path: Path, *, dtm_path: Path | None = None, leafoff_path: Path | None = None
    ) -> None:
        self._rasters: list[_Raster] = []
        try:
            self._dtm = None if dtm_path is None else self._open(dtm_path)
            self._dsm = self._open(dsm_path)
            self._leafoff = None if leafoff_path is None else self._open(leafoff_path)
        except BaseException:
            self.close()
            raise
        self._same_grid = self._leafoff is not None and _same_grid(
            self._dsm.dataset, self._leafoff.dataset
        )

    def _open(self, path: Path) -> _Raster:
        raster = _Raster(path)
        self._rasters.append(raster)
        return raster

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def close(self) -> None:
        for raster in self._rasters:
            raster.close()

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
            ground_elevation = self._ground(lat, lon)
        (profile,) = self._profiles([self._dsm], lat, lon, ground_elevation)
        return profile

    def horizons(self, lat: float, lon: float) -> tuple[list[int], list[int] | None]:
        """The summer profile at ``(lat, lon)`` and, with a leaf-off model, the leaf-off one.

        Each is exactly what a ``HorizonModel`` of that surface model alone would return; the
        ground elevation comes from the terrain model.

        Raises:
            ValueError: As ``horizon``.
        """
        ground_elevation = self._ground(lat, lon)
        if self._leafoff is None:
            return self._profiles([self._dsm], lat, lon, ground_elevation)[0], None
        if self._same_grid:
            summer, winter = self._profiles([self._dsm, self._leafoff], lat, lon, ground_elevation)
            return summer, winter
        (summer,) = self._profiles([self._dsm], lat, lon, ground_elevation)
        (winter,) = self._profiles([self._leafoff], lat, lon, ground_elevation)
        return summer, winter

    def _ground(self, lat: float, lon: float) -> float:
        if self._dtm is None:
            raise ValueError("give exactly one of dtm_path and ground_elevation")
        return self._dtm.ground_elevation(lat, lon)

    def _profiles(
        self, rasters: Sequence[_Raster], lat: float, lon: float, ground_elevation: float
    ) -> list[list[int]]:
        """Profiles on ``rasters``, which share the first one's grid, in their order."""
        first = rasters[0]
        x, y, true_north_bearing = first.project(lat, lon)
        window = _window_around(first.dataset, x, y, MAX_DISTANCE_M)
        if window is None:
            raise ValueError(f"terrace ({lat}, {lon}) is outside {first.path}")
        transform: Affine = first.dataset.window_transform(window)
        surfaces = [
            (
                np.asarray(raster.dataset.read(1, window=window), dtype=np.float64),
                None if raster.dataset.nodata is None else float(raster.dataset.nodata),
            )
            for raster in rasters
        ]
        return horizon_profiles(
            surfaces, transform, x, y, ground_elevation, true_north_bearing=true_north_bearing
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


def _same_grid(a: DatasetReader, b: DatasetReader) -> bool:
    """Whether two rasters share CRS, transform and size, so one window means the same cells."""
    return (
        a.crs is not None
        and b.crs is not None
        and a.crs.to_wkt() == b.crs.to_wkt()
        and a.transform == b.transform
        and (a.width, a.height) == (b.width, b.height)
    )


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

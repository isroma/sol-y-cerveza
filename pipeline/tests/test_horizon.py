import math
import time
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine
from numpy.typing import NDArray
from pyproj import Proj, Transformer

from solycerveza.horizon import (
    BINS,
    EYE_HEIGHT_M,
    HorizonModel,
    horizon_profile,
    terrace_horizon,
)

GROUND = 180.0
PIXEL = 2.0
SIZE = 401  # cells per side; the observer stands at the centre of cell (200, 200)
# Origin chosen so that the observer is at (0, 0) and cell centres fall on even coordinates.
TRANSFORM = Affine.translation(-SIZE, SIZE) @ Affine.scale(PIXEL, -PIXEL)

# Cell-centre coordinates of the synthetic grid, relative to the observer.
_ROWS, _COLS = np.mgrid[0:SIZE, 0:SIZE]
XS = -400.0 + PIXEL * _COLS
YS = 400.0 - PIXEL * _ROWS

WALL_DISTANCE = 101.0  # near face of the wall, on a cell boundary
WALL_HEIGHT = 50.0  # above the eye
WALL_HALF_WIDTH = 30.0  # cell centres; the wall spans about ±17° seen from the observer


def flat() -> NDArray[np.float64]:
    return np.full((SIZE, SIZE), GROUND)


def with_north_wall(surface: NDArray[np.float64]) -> NDArray[np.float64]:
    """Adds a 6 m thick wall due (grid) north, its near face WALL_DISTANCE m away."""
    near_edge = YS - PIXEL / 2
    wall = (
        (near_edge >= WALL_DISTANCE)
        & (near_edge < WALL_DISTANCE + 6)
        & (np.abs(XS) <= WALL_HALF_WIDTH)
    )
    surface[wall] = GROUND + EYE_HEIGHT_M + WALL_HEIGHT
    return surface


def rotate_clockwise(surface: NDArray[np.float64], quarter_turns: int) -> NDArray[np.float64]:
    """Rotates the grid about the observer: a north wall ends up at 90° x quarter_turns."""
    return np.ascontiguousarray(np.rot90(surface, k=-quarter_turns))


def profile(
    surface: NDArray[np.float64], *, nodata: float | None = None, true_north_bearing: float = 0.0
) -> list[int]:
    return horizon_profile(
        surface, TRANSFORM, 0.0, 0.0, GROUND, nodata=nodata, true_north_bearing=true_north_bearing
    )


def angular_gap(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def assert_walls_at(result: list[int], *azimuths: float) -> None:
    """Each wall reads at the expected angle within ±0.5°, and nothing else is seen.

    Bins near a wall's ends (14° to 20° off its centre) are partly covered and not checked.
    """
    for i, value in enumerate(result):
        offset = min(angular_gap(i, azimuth) for azimuth in azimuths)
        if offset <= 14:
            # A straight wall at distance D is D / cos(offset) away along the ray.
            expected = math.degrees(
                math.atan(WALL_HEIGHT * math.cos(math.radians(offset)) / WALL_DISTANCE)
            )
            assert value == pytest.approx(expected * 10, abs=5), f"bin {i}"
        elif offset >= 20:
            assert value == 0, f"bin {i}"


def test_flat_ground_is_all_zeros() -> None:
    result = profile(flat())
    assert len(result) == BINS
    assert all(type(value) is int for value in result)
    assert result == [0] * BINS


@pytest.mark.parametrize(("quarter_turns", "azimuth"), [(0, 0), (1, 90), (2, 180), (3, 270)])
def test_wall_reads_in_the_right_bins(quarter_turns: int, azimuth: float) -> None:
    surface = rotate_clockwise(with_north_wall(flat()), quarter_turns)
    assert_walls_at(profile(surface), azimuth)


def test_true_north_bearing_rotates_the_profile() -> None:
    # True north 90° clockwise from grid north: a grid-north wall is due west.
    assert_walls_at(profile(with_north_wall(flat()), true_north_bearing=90.0), 270)


@pytest.mark.parametrize("clockwise", [90.0, 30.0])
def test_a_rotated_raster_reads_walls_in_world_directions(clockwise: float) -> None:
    # Not north-up: the pixel grid itself turned clockwise round the observer, so every term of
    # the pixel-to-world transform counts and the grid-north wall turns with it.
    transform = Affine.rotation(-clockwise) @ TRANSFORM
    result = horizon_profile(with_north_wall(flat()), transform, 0.0, 0.0, GROUND)
    assert_walls_at(result, clockwise)


def test_ground_dropping_away_is_clamped_to_zero() -> None:
    hill = GROUND - 0.2 * np.hypot(XS, YS)
    assert profile(hill) == [0] * BINS


def test_observer_cell_is_ignored() -> None:
    surface = flat()
    surface[200, 200] = GROUND + 20  # e.g. an awning over the tables
    assert profile(surface) == [0] * BINS


def test_thin_obstacle_between_bin_centres_is_seen() -> None:
    # A single 2 m cell centred at (46, 246): ~250 m away, azimuths 10.33° to 10.86°. The 10°
    # and 11° rays pass at least 0.6 m to either side of it, so only the sub-rays catch it.
    surface = flat()
    surface[77, 223] = GROUND + EYE_HEIGHT_M + 30
    result = profile(surface)
    expected = math.degrees(math.atan(30 / math.hypot(46, 246))) * 10
    assert max(result[10], result[11]) == pytest.approx(expected, abs=5)
    assert [v for i, v in enumerate(result) if i not in (10, 11)] == [0] * (BINS - 2)


@pytest.mark.parametrize(("fill", "nodata"), [(32767.0, 32767.0), (math.nan, None)])
def test_nodata_cells_are_skipped_without_stopping_the_ray(
    fill: float, nodata: float | None
) -> None:
    surface = with_north_wall(flat())
    surface[(YS > 40) & (YS < 60)] = fill  # a band of nodata between observer and wall
    assert_walls_at(profile(surface, nodata=nodata), 0)


def test_rays_stop_at_the_raster_edge() -> None:
    surface = flat()
    for _ in range(4):
        surface = rotate_clockwise(with_north_wall(surface), 1)
    assert_walls_at(profile(surface), 0, 90, 180, 270)
    # Crop the raster 39 m east of the observer: the east wall is gone, the others remain.
    cropped = np.ascontiguousarray(surface[:, :220])
    assert_walls_at(profile(cropped), 0, 180, 270)


def test_observer_outside_the_raster_is_rejected() -> None:
    with pytest.raises(ValueError, match="outside"):
        horizon_profile(flat(), TRANSFORM, 1000.0, 0.0, GROUND)


def test_ground_elevation_must_be_finite() -> None:
    with pytest.raises(ValueError, match="finite"):
        horizon_profile(flat(), TRANSFORM, 0.0, 0.0, math.nan)


# Plaza de España, Badajoz. EPSG:25829 grid north is ~1.27° east of true north here.
LAT, LON = 38.8789, -6.9707
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True)


def write_geotiff(
    path: Path, array: NDArray[np.float64], transform: Affine, crs: str = "EPSG:25829"
) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        height=array.shape[0],
        width=array.shape[1],
        count=1,
        dtype="float32",
        crs=crs,
        transform=transform,
        nodata=-9999.0,
    ) as dst:
        dst.write(array.astype(np.float32), 1)
    return path


@pytest.fixture
def utm_dsm(tmp_path: Path) -> tuple[Path, NDArray[np.float64], Affine]:
    """A 2 m DSM over ±400 m around the plaza (larger than the 300 m window read), with a wall
    due grid north of the observer's cell."""
    x, y = TO_UTM.transform(LON, LAT)
    # Shift the synthetic grid so that the observer's cell keeps the same layout.
    col, row = ~TRANSFORM @ (0.0, 0.0)
    transform = Affine.translation(x - col * PIXEL, y + row * PIXEL) @ Affine.scale(PIXEL, -PIXEL)
    surface = with_north_wall(flat())
    return write_geotiff(tmp_path / "dsm.tif", surface, transform), surface, transform


def test_terrace_horizon_matches_the_core_on_the_full_raster(
    utm_dsm: tuple[Path, NDArray[np.float64], Affine],
) -> None:
    path, surface, transform = utm_dsm
    x, y = TO_UTM.transform(LON, LAT)
    convergence = Proj("EPSG:25829").get_factors(LON, LAT).meridian_convergence
    expected = horizon_profile(
        surface, transform, x, y, GROUND, nodata=-9999.0, true_north_bearing=-convergence
    )
    result = terrace_horizon(LAT, LON, path, ground_elevation=GROUND)
    assert result == expected
    # A wall due grid north reads ~1.27° east of true north.
    assert_walls_at(result, convergence)


def test_terrace_horizon_takes_ground_from_the_dtm(
    tmp_path: Path, utm_dsm: tuple[Path, NDArray[np.float64], Affine]
) -> None:
    dsm_path, surface, transform = utm_dsm
    dtm_path = write_geotiff(tmp_path / "dtm.tif", np.full_like(surface, GROUND + 10), transform)
    from_dtm = terrace_horizon(LAT, LON, dsm_path, dtm_path=dtm_path)
    assert from_dtm == terrace_horizon(LAT, LON, dsm_path, ground_elevation=GROUND + 10)
    assert from_dtm != terrace_horizon(LAT, LON, dsm_path, ground_elevation=GROUND)


def test_terrace_horizon_rejects_missing_terrain_data(
    tmp_path: Path, utm_dsm: tuple[Path, NDArray[np.float64], Affine]
) -> None:
    dsm_path, surface, transform = utm_dsm
    dtm_path = write_geotiff(tmp_path / "dtm.tif", np.full_like(surface, -9999.0), transform)
    with pytest.raises(ValueError, match="no terrain data"):
        terrace_horizon(LAT, LON, dsm_path, dtm_path=dtm_path)


def test_terrace_horizon_needs_exactly_one_ground_source(
    utm_dsm: tuple[Path, NDArray[np.float64], Affine],
) -> None:
    path = utm_dsm[0]
    with pytest.raises(ValueError, match="exactly one"):
        terrace_horizon(LAT, LON, path)
    with pytest.raises(ValueError, match="exactly one"):
        terrace_horizon(LAT, LON, path, dtm_path=path, ground_elevation=GROUND)


def test_terrace_horizon_rejects_a_terrace_outside_the_dsm(
    utm_dsm: tuple[Path, NDArray[np.float64], Affine],
) -> None:
    with pytest.raises(ValueError, match="outside"):
        terrace_horizon(LAT + 0.01, LON, utm_dsm[0], ground_elevation=GROUND)


def test_terrace_horizon_rejects_a_geographic_crs(tmp_path: Path) -> None:
    transform = Affine.translation(LON - 0.01, LAT + 0.01) @ Affine.scale(0.001, -0.001)
    path = write_geotiff(tmp_path / "dsm.tif", np.full((20, 20), GROUND), transform, "EPSG:4326")
    with pytest.raises(ValueError, match="projected CRS in metres"):
        terrace_horizon(LAT, LON, path, ground_elevation=GROUND)


def test_an_open_model_gives_the_same_profiles_as_terrace_horizon(
    tmp_path: Path, utm_dsm: tuple[Path, NDArray[np.float64], Affine]
) -> None:
    dsm_path, surface, transform = utm_dsm
    ground = GROUND + np.arange(surface.size, dtype=np.float64).reshape(surface.shape) % 7
    dtm_path = write_geotiff(tmp_path / "dtm.tif", ground, transform)
    # Points around the plaza, some near the wall, so the profiles differ.
    points = [(LAT + dlat, LON + dlon) for dlat in (-5e-4, 0, 4e-4) for dlon in (-6e-4, 0, 3e-4)]
    with HorizonModel(dsm_path, dtm_path=dtm_path) as model:
        profiles = [model.horizon(lat, lon) for lat, lon in points]
        with pytest.raises(ValueError, match="outside"):
            model.horizon(LAT + 0.01, LON)
        assert model.horizon(LAT, LON, ground_elevation=GROUND) == terrace_horizon(
            LAT, LON, dsm_path, ground_elevation=GROUND
        )
    assert profiles == [
        terrace_horizon(lat, lon, dsm_path, dtm_path=dtm_path) for lat, lon in points
    ]
    assert len({tuple(p) for p in profiles}) > 1


def test_an_open_model_without_terrain_needs_a_ground_elevation(
    utm_dsm: tuple[Path, NDArray[np.float64], Affine],
) -> None:
    with HorizonModel(utm_dsm[0]) as model, pytest.raises(ValueError, match="exactly one"):
        model.horizon(LAT, LON)


def test_a_profile_on_a_2m_raster_takes_milliseconds() -> None:
    # A performance bound: the build computes one profile per terrace (about a thousand), so a
    # regression to a slower algorithm must fail here. The cost is linear in the number of
    # points, so a sample of 100 checks the same per-point budget as 1000 would, in a tenth of
    # the time.
    rng = np.random.default_rng(0)
    size = 1000  # 2 km x 2 km
    surface = np.full((size, size), GROUND)
    for _ in range(3000):
        row, col = rng.integers(0, size - 20, 2)
        rows, cols = rng.integers(3, 20, 2)
        surface[row : row + rows, col : col + cols] = GROUND + rng.uniform(3, 25)
    transform = Affine.scale(PIXEL, -PIXEL)
    count = 100
    points = rng.uniform(0, size * PIXEL, (count, 2))
    start = time.perf_counter()
    for x, y in points:
        horizon_profile(surface, transform, float(x), -float(y), GROUND)
    # 2-17 ms per point on a laptop or a cloud container; 30 ms leaves room for slow CI runners.
    assert (time.perf_counter() - start) / count < 0.030

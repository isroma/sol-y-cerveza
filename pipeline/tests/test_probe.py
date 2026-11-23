import io
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import rasterio
from numpy.typing import NDArray
from pyproj import Transformer
from rasterio.transform import from_origin

from solycerveza.build import MAX_HEIGHT_ABOVE_GROUND_M
from solycerveza.horizon import BINS, EYE_HEIGHT_M
from solycerveza.probe import MISSING_RASTERS, main, probe

LAT, LON = 38.88256, -6.96976  # Plaza Alta
GROUND = 190.0
PIXEL = 2.0
SIZE = 200  # 400 m x 400 m around the point
WALL_DISTANCE = 20.0  # south of the point, near face
WALL_HEIGHT = 20.0  # above the eye

_X, _Y = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True).transform(LON, LAT)
# Snap the grid so the point sits at the centre of a cell.
_LEFT = math.floor(_X / PIXEL) * PIXEL - (SIZE // 2) * PIXEL
_TOP = math.floor(_Y / PIXEL) * PIXEL + (SIZE // 2 + 1) * PIXEL


def _write(path: Path, data: NDArray[np.float32]) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=SIZE,
        height=SIZE,
        count=1,
        dtype="float32",
        crs="EPSG:25829",
        transform=from_origin(_LEFT, _TOP, PIXEL, PIXEL),
        nodata=-9999.0,
    ) as dst:
        dst.write(data, 1)
    return path


def _cell_centres() -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    rows, cols = np.mgrid[0:SIZE, 0:SIZE]
    return _LEFT + PIXEL * (cols + 0.5), _TOP - PIXEL * (rows + 0.5)


def _rasters(tmp_path: Path, *, roof: float = 0.0) -> tuple[Path, Path]:
    """A flat street with a wall to the south; ``roof`` raises the surface under the point."""
    xs, ys = _cell_centres()
    dsm = np.full((SIZE, SIZE), GROUND, dtype=np.float32)
    south_of_point = _Y - ys
    wall = (
        (south_of_point >= WALL_DISTANCE)
        & (south_of_point < WALL_DISTANCE + 6)
        & (np.abs(xs - _X) <= 60)
    )
    dsm[wall] = GROUND + EYE_HEIGHT_M + WALL_HEIGHT
    if roof:
        dsm[np.hypot(xs - _X, ys - _Y) < 3] = GROUND + roof
    dtm = np.full((SIZE, SIZE), GROUND, dtype=np.float32)
    return _write(tmp_path / "dsm.tif", dsm), _write(tmp_path / "dtm.tif", dtm)


def test_probe_sees_the_wall_to_the_south(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    result = probe(LAT, LON, dsm, dtm)

    horizon = result["horizon"]
    assert isinstance(horizon, list)
    assert len(horizon) == BINS
    expected = math.degrees(math.atan(WALL_HEIGHT / WALL_DISTANCE)) * 10
    assert horizon[180] == pytest.approx(expected, abs=25)
    assert horizon[0] == 0
    assert result["height_above_ground"] == pytest.approx(0.0)
    assert result["max_height_above_ground"] == MAX_HEIGHT_ABOVE_GROUND_M


def test_probe_reports_a_point_on_a_roof(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path, roof=7.456)
    assert probe(LAT, LON, dsm, dtm)["height_above_ground"] == 7.46


def test_probe_rejects_points_outside_badajoz(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    with pytest.raises(ValueError, match="outside the Badajoz bounding box"):
        probe(40.4168, -3.7038, dsm, dtm)


def test_main_prints_one_json_object(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    out = io.StringIO()
    code = main(["--lat", str(LAT), "--lon", str(LON), "--dsm", str(dsm), "--dtm", str(dtm)], out)
    assert code == 0
    (line,) = out.getvalue().splitlines()
    payload = json.loads(line)
    assert set(payload) == {"horizon", "height_above_ground", "max_height_above_ground"}
    assert len(payload["horizon"]) == BINS


def test_main_explains_missing_rasters(tmp_path: Path) -> None:
    out = io.StringIO()
    code = main(["--lat", str(LAT), "--lon", str(LON), "--dsm", str(tmp_path / "no.tif")], out)
    assert code == 2
    assert json.loads(out.getvalue()) == {"error": MISSING_RASTERS, "missing_rasters": True}


def test_main_reports_a_point_outside_the_rasters_as_an_error(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    out = io.StringIO()
    # Inside Badajoz, several kilometres away from the 400 m test rasters.
    code = main(["--lat", "38.85", "--lon", "-7.0", "--dsm", str(dsm), "--dtm", str(dtm)], out)
    assert code == 1
    assert "outside" in json.loads(out.getvalue())["error"]


def test_runs_as_a_module(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    args = ["--lat", str(LAT), "--lon", str(LON), "--dsm", str(dsm), "--dtm", str(dtm)]
    done = subprocess.run(
        [sys.executable, "-m", "solycerveza.probe", *args],
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    assert len(json.loads(done.stdout)["horizon"]) == BINS

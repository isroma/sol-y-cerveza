import hashlib
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

from solycerveza import probe as probe_module
from solycerveza.build import MAX_HEIGHT_ABOVE_GROUND_M
from solycerveza.envelope import unpack
from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.horizon import BINS, EYE_HEIGHT_M
from solycerveza.leafoff import structures_query
from solycerveza.probe import MISSING_RASTERS, main, probe
from solycerveza.roads import Road, roads_query

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


@pytest.fixture(autouse=True)
def _no_osm(monkeypatch: pytest.MonkeyPatch) -> None:
    """No OSM structures or roads unless a test sets them: tests never reach Overpass."""
    monkeypatch.setattr(probe_module, "load_structures", lambda **_: [])
    monkeypatch.setattr(probe_module, "load_roads", lambda **_: [])


def _empty_osm_cache(cache_dir: Path) -> Path:
    """Empty cached Overpass answers for structures and roads, named as ``cached_overpass`` does."""
    for prefix, query in (
        ("overpass_structures", structures_query(BADAJOZ_BBOX)),
        ("overpass_roads", roads_query(BADAJOZ_BBOX)),
    ):
        digest = hashlib.sha256(query.encode()).hexdigest()[:12]
        (cache_dir / f"{prefix}_{digest}.json").write_text('{"elements": []}', encoding="utf-8")
    return cache_dir


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


def test_probe_returns_the_envelope_across_the_terrace(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    result = probe(LAT, LON, dsm, dtm)

    horizon, low = result["horizon"], result["horizon_low"]
    assert isinstance(horizon, list)
    assert isinstance(low, str)
    # Tables 6 m north of the pin are 26 m from the wall: it stands lower from there.
    assert unpack(low)[180] * 10 < horizon[180] - 30


def test_probe_returns_each_cell_of_the_terrace_with_its_horizon(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    cells = probe(LAT, LON, dsm, dtm)["cells"]

    assert 32 <= len(cells) <= 42
    assert all(cell["skip"] is None for cell in cells)
    horizons = [cell["horizon"] for cell in cells]
    assert all(isinstance(h, str) and len(h) == BINS for h in horizons)
    # The cells nearest the wall to the south see it highest.
    south = min(cells, key=lambda cell: cell["lat"])
    north = max(cells, key=lambda cell: cell["lat"])
    assert isinstance(south["horizon"], str) and isinstance(north["horizon"], str)
    assert unpack(south["horizon"])[180] > unpack(north["horizon"])[180]


def test_probe_says_why_a_cell_is_left_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    dsm, dtm = _rasters(tmp_path, roof=7.0)  # a 3 m roof round the pin
    monkeypatch.setattr(probe_module, "load_roads", lambda **_: [_road_over_the_north_half()])
    cells = probe(LAT, LON, dsm, dtm)["cells"]

    skips = {cell["skip"] for cell in cells}
    assert {"raised", "road", None} <= skips
    for cell in cells:
        assert (cell["horizon"] is None) == (cell["skip"] is not None)


def test_probe_returns_the_leaf_off_envelope(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    _with_crown(dsm)
    result = probe(LAT, LON, dsm, dtm, _leafoff(tmp_path))

    low, low_winter = result["horizon_low"], result["horizon_low_winter"]
    assert isinstance(low, str) and isinstance(low_winter, str)
    assert all(w <= s for w, s in zip(unpack(low_winter), unpack(low), strict=True))
    # Cells that see the crown to the north see past it once it is bare.
    bare = [c for c in result["cells"] if c["horizon_winter"] is not None]
    assert bare
    for cell in bare:
        assert isinstance(cell["horizon"], str) and isinstance(cell["horizon_winter"], str)
        assert sum(unpack(cell["horizon_winter"])) < sum(unpack(cell["horizon"]))
    assert probe(LAT, LON, dsm, dtm)["horizon_low_winter"] is None


def _road_over_the_north_half() -> Road:
    """A 20 m wide road from west to east, its south edge 1 m north of the pin."""
    north = (LAT + 11 / 111_320, LON)
    east_m = 30 / (111_320 * math.cos(math.radians(LAT)))
    return Road(points=((north[1] - east_m, north[0]), (north[1] + east_m, north[0])), width_m=20)


def test_probe_leaves_the_road_out_of_the_envelope(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dsm, dtm = _rasters(tmp_path)
    open_low = probe(LAT, LON, dsm, dtm)["horizon_low"]
    monkeypatch.setattr(probe_module, "load_roads", lambda **_: [_road_over_the_north_half()])

    low = probe(LAT, LON, dsm, dtm)["horizon_low"]

    assert isinstance(open_low, str)
    assert isinstance(low, str)
    assert unpack(low)[180] > unpack(open_low)[180]


def _leafoff(tmp_path: Path) -> Path:
    """The same street as ``_rasters`` with a bare tree crown 10 m north of the point lowered
    away; the full DSM gets the crown from ``_with_crown``."""
    xs, ys = _cell_centres()
    dsm = np.full((SIZE, SIZE), GROUND, dtype=np.float32)
    south_of_point = _Y - ys
    wall = (
        (south_of_point >= WALL_DISTANCE)
        & (south_of_point < WALL_DISTANCE + 6)
        & (np.abs(xs - _X) <= 60)
    )
    dsm[wall] = GROUND + EYE_HEIGHT_M + WALL_HEIGHT
    return _write(tmp_path / "leafoff.tif", dsm)


def _with_crown(dsm_path: Path) -> None:
    xs, ys = _cell_centres()
    with rasterio.open(dsm_path, "r+") as dst:
        data = dst.read(1)
        data[np.hypot(xs - _X, ys - (_Y + 10)) < 4] = GROUND + 12
        dst.write(data, 1)


def test_probe_returns_the_leaf_off_horizon(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    _with_crown(dsm)
    leafoff = _leafoff(tmp_path)

    result = probe(LAT, LON, dsm, dtm, leafoff)
    horizon, winter = result["horizon"], result["horizon_winter"]
    assert isinstance(horizon, list)
    assert isinstance(winter, list)
    assert horizon[0] > 300  # the crown, ~45° up to the north
    assert winter[0] == 0
    assert winter[180] == horizon[180]  # the wall stays


def test_probe_has_no_winter_horizon_without_the_leaf_off_model(tmp_path: Path) -> None:
    dsm, dtm = _rasters(tmp_path)
    assert probe(LAT, LON, dsm, dtm)["horizon_winter"] is None
    assert probe(LAT, LON, dsm, dtm, tmp_path / "missing.tif")["horizon_winter"] is None
    # Same surface: nothing to add.
    assert probe(LAT, LON, dsm, dtm, dsm)["horizon_winter"] is None


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
    no_leafoff = str(tmp_path / "none.tif")
    args = ["--lat", str(LAT), "--lon", str(LON), "--dsm", str(dsm), "--dtm", str(dtm)]
    code = main([*args, "--dsm-leafoff", no_leafoff], out)
    assert code == 0
    (line,) = out.getvalue().splitlines()
    payload = json.loads(line)
    assert set(payload) == {
        "horizon",
        "horizon_winter",
        "horizon_low",
        "horizon_low_winter",
        "height_above_ground",
        "max_height_above_ground",
        "cells",
    }
    assert payload["horizon_winter"] is None
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
    args += ["--cache-dir", str(_empty_osm_cache(tmp_path))]
    done = subprocess.run(
        [sys.executable, "-m", "solycerveza.probe", *args],
        capture_output=True,
        text=True,
        check=True,
        timeout=120,
    )
    assert len(json.loads(done.stdout)["horizon"]) == BINS

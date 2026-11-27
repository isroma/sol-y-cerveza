import math

import pytest
from pyproj import Transformer
from rasterio.transform import from_origin

from solycerveza.envelope import (
    MAX_GROUND_HEIGHT_M,
    PACK_ALPHABET,
    SAMPLE_RADIUS_M,
    SampleGrid,
    Structures,
    ground_points,
    lowest,
    pack_low,
    sample_points,
    terrace_points,
    unpack,
)
from solycerveza.leafoff import Outline

PIN = (38.88256, -6.96976)
_X, _Y = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True).transform(PIN[1], PIN[0])
# A 2 m grid with the pin at the centre of a cell, as the LiDAR rasters are laid out.
GRID = SampleGrid(
    from_origin(math.floor(_X / 2) * 2 - 100, math.floor(_Y / 2) * 2 + 102, 2, 2), "EPSG:25829"
)


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    north = (b[0] - a[0]) * 111_320
    east = (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(north, east)


def test_sample_points_are_the_pin_then_the_grid_cells_within_7_m() -> None:
    points = sample_points(*PIN, GRID)
    assert points[0] == PIN
    assert len(set(points)) == len(points)
    assert all(_metres(PIN, p) <= SAMPLE_RADIUS_M + 0.05 for p in points)
    # A 7 m disc holds about 38 cells of 4 m², the pin's own left out.
    assert 32 <= len(points) - 1 <= 42
    # Grid rows from the north, west to east, 2 m apart.
    first, second = points[1], points[2]
    assert first[0] > PIN[0]
    # UTM rows run 1.3° off the parallels at Badajoz: under 0.1 m over 2 m.
    assert _metres(first, (second[0], first[1])) < 0.1 and first[1] < second[1]
    assert _metres(first, second) == pytest.approx(2.0, abs=0.05)


def test_sample_points_are_cell_centres() -> None:
    to_grid = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True)
    for lat, lon in sample_points(*PIN, GRID)[1:]:
        col, row = ~GRID.transform @ to_grid.transform(lon, lat)
        assert col % 1 == pytest.approx(0.5, abs=1e-6)
        assert row % 1 == pytest.approx(0.5, abs=1e-6)


def test_sample_points_are_deterministic() -> None:
    assert sample_points(*PIN, GRID) == sample_points(*PIN, GRID)


def test_ground_points_drop_canopies_roofs_and_buildings() -> None:
    points = [(1.0, 1.0), (2.0, 2.0), (3.0, 3.0), (4.0, 4.0)]
    heights = {1.0: 0.2, 2.0: MAX_GROUND_HEIGHT_M + 0.5, 3.0: 0.1, 4.0: None}

    kept = ground_points(
        points, lambda lat, _lon: heights[lat], lambda lat, _lon: lat == 3.0, lambda *_: False
    )

    assert kept == [(1.0, 1.0)]


def test_ground_points_drop_the_road() -> None:
    points = [(1.0, 1.0), (2.0, 2.0)]
    kept = ground_points(points, lambda *_: 0.0, lambda *_: False, lambda lat, _lon: lat == 2.0)
    assert kept == [(1.0, 1.0)]


def test_structures_contain_points_inside_closed_outlines_only() -> None:
    square = Outline(points=((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)))
    wall = Outline(points=((2.0, 0.0), (3.0, 1.0)))
    structures = Structures([square, wall])
    assert structures.contains(0.5, 0.5)
    assert not structures.contains(0.5, 1.5)
    assert not structures.contains(0.5, 2.5)


def test_lowest_is_the_per_bin_min() -> None:
    assert lowest([[1, 5, 3], [4, 2, 3], [2, 2, 9]]) == [1, 2, 3]


def test_lowest_needs_a_horizon() -> None:
    with pytest.raises(ValueError, match="at least one"):
        lowest([])


def test_packing_rounds_down_to_whole_degrees() -> None:
    tenths = [0, 1, 9, 10, 11, 899, 900]
    assert unpack(pack_low(tenths)) == [0, 0, 0, 1, 1, 89, 90]


def test_the_pack_alphabet_needs_no_json_escaping() -> None:
    assert len(PACK_ALPHABET) == 91
    assert '"' not in PACK_ALPHABET and "\\" not in PACK_ALPHABET
    assert all(35 <= ord(c) <= 126 for c in PACK_ALPHABET)


def test_terrace_points_are_the_grid_on_open_ground() -> None:
    points = terrace_points(*PIN, GRID, lambda *_: 0.0, lambda *_: False, lambda *_: False)
    assert points == sample_points(*PIN, GRID)


def test_terrace_points_skip_the_canopy_over_the_pin() -> None:
    def canopy_within_3_m(lat: float, lon: float) -> float:
        return 5.0 if _metres(PIN, (lat, lon)) < 3 else 0.0

    points = terrace_points(*PIN, GRID, canopy_within_3_m, lambda *_: False, lambda *_: False)
    assert PIN not in points
    assert points and all(_metres(PIN, p) >= 3 for p in points)


def test_terrace_points_can_be_empty() -> None:
    assert terrace_points(*PIN, GRID, lambda *_: 5.0, lambda *_: False, lambda *_: False) == []

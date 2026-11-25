import math

import pytest

from solycerveza.envelope import (
    MAX_GROUND_HEIGHT_M,
    Structures,
    envelope,
    ground_points,
    sample_points,
)
from solycerveza.leafoff import Outline

PIN = (38.88256, -6.96976)


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    north = (b[0] - a[0]) * 111_320
    east = (b[1] - a[1]) * 111_320 * math.cos(math.radians(a[0]))
    return math.hypot(north, east)


def test_sample_points_are_the_pin_then_a_ring_from_north_clockwise() -> None:
    points = sample_points(*PIN, radius_m=3.0, count=8)
    assert points[0] == PIN
    assert len(points) == 9
    assert all(_metres(PIN, p) == pytest.approx(3.0) for p in points[1:])
    north, east = points[1], points[3]
    assert north[0] > PIN[0] and north[1] == pytest.approx(PIN[1])
    assert east[1] > PIN[1] and east[0] == pytest.approx(PIN[0])


def test_sample_points_are_deterministic() -> None:
    assert sample_points(*PIN) == sample_points(*PIN)


def test_ground_points_drop_canopies_roofs_and_buildings() -> None:
    points = [(1.0, 1.0), (2.0, 2.0), (3.0, 3.0), (4.0, 4.0)]
    heights = {1.0: 0.2, 2.0: MAX_GROUND_HEIGHT_M + 0.5, 3.0: 0.1, 4.0: None}

    kept = ground_points(points, lambda lat, _lon: heights[lat], lambda lat, _lon: lat == 3.0)

    assert kept == [(1.0, 1.0)]


def test_structures_contain_points_inside_closed_outlines_only() -> None:
    square = Outline(points=((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0), (0.0, 0.0)))
    wall = Outline(points=((2.0, 0.0), (3.0, 1.0)))
    structures = Structures([square, wall])
    assert structures.contains(0.5, 0.5)
    assert not structures.contains(0.5, 1.5)
    assert not structures.contains(0.5, 2.5)


def test_envelope_is_the_per_bin_min_and_max() -> None:
    low, high = envelope([[1, 5, 3], [4, 2, 3], [2, 2, 9]])
    assert low == [1, 2, 3]
    assert high == [4, 5, 9]


def test_envelope_needs_a_horizon() -> None:
    with pytest.raises(ValueError, match="at least one"):
        envelope([])

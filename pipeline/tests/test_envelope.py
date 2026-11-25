import math
from collections.abc import Callable

import pytest

from solycerveza.envelope import (
    FALLBACK_COUNT,
    FALLBACK_RADII_M,
    MAX_GROUND_HEIGHT_M,
    PACK_ALPHABET,
    Structures,
    envelope,
    ground_points,
    pack_high,
    pack_low,
    sample_points,
    terrace_points,
    unpack,
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


def test_packing_rounds_low_down_and_high_up_to_whole_degrees() -> None:
    tenths = [0, 1, 9, 10, 11, 899, 900]
    assert unpack(pack_low(tenths)) == [0, 0, 0, 1, 1, 89, 90]
    assert unpack(pack_high(tenths)) == [0, 1, 1, 1, 2, 90, 90]


def test_the_pack_alphabet_needs_no_json_escaping() -> None:
    assert len(PACK_ALPHABET) == 91
    assert '"' not in PACK_ALPHABET and "\\" not in PACK_ALPHABET
    assert all(35 <= ord(c) <= 126 for c in PACK_ALPHABET)


def _on_ground_beyond(metres: float) -> Callable[[float, float], float]:
    """Height function: open ground only farther than `metres` from PIN."""

    def height(lat: float, lon: float) -> float:
        return 0.0 if _metres(PIN, (lat, lon)) > metres else 5.0

    return height


def test_terrace_points_keep_the_3_m_circle_when_it_has_ground() -> None:
    points = terrace_points(*PIN, lambda _a, _b: 0.0, lambda _a, _b: False)
    assert points == sample_points(*PIN)


def test_terrace_points_fall_back_to_wider_circles_under_a_canopy() -> None:
    points = terrace_points(*PIN, _on_ground_beyond(3.5), lambda _a, _b: False)
    assert len(points) == 2 * FALLBACK_COUNT
    assert {round(_metres(PIN, p)) for p in points} == set(FALLBACK_RADII_M)


def test_terrace_points_give_up_on_a_single_far_point() -> None:
    def one_point(lat: float, lon: float) -> float:
        north_at_5_m = lat > PIN[0] + 4.5 / 111_320
        return 0.0 if north_at_5_m else 5.0

    assert terrace_points(*PIN, one_point, lambda _a, _b: False) == []

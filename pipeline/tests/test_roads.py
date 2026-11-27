import math

import pytest

from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.roads import (
    DEFAULT_WIDTH_M,
    LANE_WIDTH_M,
    LINK_WIDTH_M,
    Carriageways,
    Road,
    parse_roads,
    road_width,
    roads_query,
)

LAT, LON = 38.88256, -6.96976
M_PER_DEG_LAT = 111_320.0
M_PER_DEG_LON = M_PER_DEG_LAT * math.cos(math.radians(LAT))


def _north(metres: float) -> tuple[float, float]:
    return LAT + metres / M_PER_DEG_LAT, LON


def _east_west_road(width_m: float) -> Road:
    """A 100 m road from west to east through (LAT, LON)."""
    half = 50 / M_PER_DEG_LON
    return Road(points=((LON - half, LAT), (LON + half, LAT)), width_m=width_m)


@pytest.mark.parametrize(
    ("tags", "width"),
    [
        ({"highway": "primary", "width": "12"}, 12.0),
        ({"highway": "primary", "width": "9.5 m"}, 9.5),
        ({"highway": "residential", "lanes": "2"}, 2 * LANE_WIDTH_M),
        ({"highway": "tertiary"}, DEFAULT_WIDTH_M["tertiary"]),
        ({"highway": "secondary_link"}, LINK_WIDTH_M),
        ({"highway": "residential", "width": "wide"}, DEFAULT_WIDTH_M["residential"]),
    ],
)
def test_road_width_reads_width_then_lanes_then_the_class(
    tags: dict[str, str], width: float
) -> None:
    assert road_width(tags) == width


@pytest.mark.parametrize(
    "tags",
    [
        {"highway": "pedestrian"},
        {"highway": "living_street"},
        {"highway": "footway"},
        {"highway": "residential", "tunnel": "yes"},
        {"building": "yes"},
    ],
)
def test_streets_people_sit_in_and_tunnels_are_not_carriageways(tags: dict[str, str]) -> None:
    assert road_width(tags) is None


def test_parse_roads_keeps_carriageways_with_a_line() -> None:
    geometry = [{"lat": LAT, "lon": LON}, {"lat": LAT, "lon": LON + 0.001}]
    data = {
        "elements": [
            {"type": "way", "tags": {"highway": "primary"}, "geometry": geometry},
            {"type": "way", "tags": {"highway": "pedestrian"}, "geometry": geometry},
            {"type": "way", "tags": {"highway": "primary"}, "geometry": geometry[:1]},
            {"type": "node", "tags": {"highway": "primary"}},
        ]
    }
    (road,) = parse_roads(data)
    assert road.width_m == DEFAULT_WIDTH_M["primary"]
    assert road.points == ((LON, LAT), (LON + 0.001, LAT))


def test_carriageways_cover_half_the_width_each_side() -> None:
    carriageways = Carriageways([_east_west_road(8.0)])
    assert carriageways.contains(*_north(0))
    assert carriageways.contains(*_north(3.9))
    assert not carriageways.contains(*_north(4.1))
    assert not carriageways.contains(*_north(-4.1))


def test_no_roads_cover_nothing() -> None:
    assert not Carriageways([]).contains(LAT, LON)


def test_roads_query_asks_for_road_classes_with_geometry() -> None:
    query = roads_query(BADAJOZ_BBOX)
    assert "residential|service" in query
    assert "out tags geom;" in query
    assert BADAJOZ_BBOX.overpass in query

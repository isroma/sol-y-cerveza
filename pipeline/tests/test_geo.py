import math

import pytest

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox, distance_m
from solycerveza.venues import LatLon


def test_overpass_order_is_south_west_north_east() -> None:
    bbox = BoundingBox(south=1.0, west=2.0, north=3.0, east=4.0)
    assert bbox.overpass == "1.0,2.0,3.0,4.0"


def test_badajoz_contains_plaza_de_espana() -> None:
    lat, lon = 38.8789, -6.9707
    assert BADAJOZ_BBOX.south < lat < BADAJOZ_BBOX.north
    assert BADAJOZ_BBOX.west < lon < BADAJOZ_BBOX.east


@pytest.mark.parametrize(
    ("south", "west", "north", "east"),
    [(3.0, 0.0, 1.0, 1.0), (0.0, 3.0, 1.0, 1.0), (-91.0, 0.0, 1.0, 1.0)],
)
def test_rejects_invalid_boxes(south: float, west: float, north: float, east: float) -> None:
    with pytest.raises(ValueError, match="invalid"):
        BoundingBox(south=south, west=west, north=north, east=east)


def test_distance_m_is_symmetric_and_metric() -> None:
    a = LatLon(lat=38.8789, lon=-6.9707)
    north = LatLon(lat=38.8799, lon=-6.9707)
    assert distance_m(a, a) == 0
    # 0.001° of latitude is about 111.2 m on the 6,371 km sphere.
    assert distance_m(a, north) == pytest.approx(111.19, abs=0.01)
    assert distance_m(north, a) == distance_m(a, north)
    east = LatLon(lat=38.8789, lon=-6.9697)
    assert distance_m(a, east) == pytest.approx(111.19 * math.cos(math.radians(38.8789)), abs=0.01)

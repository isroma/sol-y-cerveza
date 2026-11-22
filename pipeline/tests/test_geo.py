import pytest

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox


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

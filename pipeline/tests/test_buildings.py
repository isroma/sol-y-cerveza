import numpy as np
from affine import Affine
from pyproj import Transformer
from shapely.geometry import Polygon, box

from solycerveza.buildings import (
    DEFAULT_M,
    Building,
    Measured,
    dissolve,
    footprints,
    measure,
    parse_levels,
)
from solycerveza.obstacles import Grid

# A 2 m grid in UTM 29N, in Badajoz.
GRID = Grid("EPSG:25829", Affine(2.0, 0, 676000.0, 0, -2.0, 4304000.0), 40, 40)
TO_WGS84 = Transformer.from_crs(GRID.crs, "EPSG:4326", always_xy=True)
TO_GRID = Transformer.from_crs("EPSG:4326", GRID.crs, always_xy=True)


def geometry(xs: list[float], ys: list[float]) -> list[dict[str, float]]:
    lons, lats = TO_WGS84.transform(xs, ys)
    return [{"lon": lon, "lat": lat} for lon, lat in zip(lons, lats, strict=True)]


def square(x0: float, y0: float, size: float) -> list[dict[str, float]]:
    xs = [x0, x0 + size, x0 + size, x0, x0]
    ys = [y0, y0, y0 - size, y0 - size, y0]
    return geometry(xs, ys)


def test_footprints_read_ways_and_multipolygons_but_not_roofs() -> None:
    data = {
        "elements": [
            {
                "type": "way",
                "id": 1,
                "tags": {"building": "yes", "building:levels": "4"},
                "geometry": square(676010, 4303990, 10),
            },
            {
                "type": "way",
                "id": 2,
                "tags": {"building": "roof"},
                "geometry": square(676030, 4303990, 10),
            },
            {
                "type": "way",
                "id": 3,
                "tags": {"barrier": "wall"},
                "geometry": square(676050, 4303990, 10),
            },
            {
                "type": "relation",
                "id": 4,
                "tags": {"building": "apartments", "type": "multipolygon"},
                "members": [
                    {"role": "outer", "geometry": square(676010, 4303960, 20)},
                    {"role": "inner", "geometry": square(676016, 4303954, 8)},
                ],
            },
        ]
    }
    buildings = footprints(data, TO_GRID)
    assert [(b.osm_id, b.levels) for b in buildings] == [("way/1", 4.0), ("relation/4", None)]
    assert abs(buildings[0].footprint.area - 100) < 1
    assert abs(buildings[1].footprint.area - (400 - 64)) < 2  # the courtyard is a hole


def test_parse_levels() -> None:
    assert parse_levels("3") == 3.0
    assert parse_levels("2;3") is None
    assert parse_levels(None) is None
    assert parse_levels("0") is None


def test_measure_uses_the_lidar_then_levels_then_a_default() -> None:
    heights = np.zeros((40, 40))
    heights[2:12, 2:12] = 15.0  # a block, 20 x 20 m
    heights[3:5, 3:5] = 3.0  # with a low terrace on it, under the 75th percentile

    def at(col: int, row: int, size: int) -> Polygon:
        x, y = 676000.0 + col * 2, 4304000.0 - row * 2
        return box(x, y - size * 2, x + size * 2, y)

    buildings = [
        Building("way/1", at(2, 2, 10), None),
        Building("way/2", at(20, 20, 6), 5.0),  # nothing in the LiDAR, 5 levels
        Building("way/3", at(30, 2, 6), None),  # nothing at all
    ]
    measured = measure(buildings, heights, GRID)
    assert [(m.height, m.source) for m in measured] == [
        (15.0, "lidar"),
        (15.0, "levels"),
        (DEFAULT_M, "default"),
    ]


def test_dissolve_merges_touching_buildings_of_similar_height_only() -> None:
    def measured(x: float, height: float) -> Measured:
        return Measured(Building("way/x", box(x, 0, x + 10, 10), None), height, "lidar")

    rows = [
        measured(0, 10.0),
        measured(10, 11.0),  # touches the first, 1 m taller: merged
        measured(20, 12.0),  # would stretch the group to 2 m: kept apart
        measured(50, 10.0),  # far away
    ]
    out = sorted((top, round(polygon.area)) for _, top, polygon in dissolve(rows))
    assert out == [(10.0, 100), (10.5, 200), (12.0, 100)]

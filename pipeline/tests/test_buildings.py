import numpy as np
import pytest
from affine import Affine
from pyproj import Transformer
from shapely import affinity
from shapely.geometry import Polygon, box

from solycerveza.buildings import (
    DEFAULT_M,
    HEIGHT_STEP_M,
    MERLON_HEIGHT_M,
    Building,
    Measured,
    crenellate,
    dissolve,
    drop_canopy,
    footprints,
    measure,
    parse_levels,
    straighten,
    tall_parts,
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


def test_tall_parts_raise_a_tower_out_of_its_building() -> None:
    def at(col: int, row: int, size: int) -> Polygon:
        x, y = 676000.0 + col * 2, 4304000.0 - row * 2
        return box(x, y - size * 2, x + size * 2, y)

    heights = np.zeros((40, 40))
    heights[2:22, 2:22] = 15.0  # a nave, 40 x 40 m
    heights[5:9, 5:9] = 36.0  # a tower, 8 x 8 m, on it
    heights[15, 15] = 30.0  # one tall cell: an antenna, not a part
    church = Building("relation/1", at(2, 2, 20), None)
    (nave,) = measure([church], heights, GRID)
    assert nave.height == 15.0

    (tower,) = tall_parts([nave], heights, GRID)
    assert tower.source == "lidar-part"
    assert tower.building.osm_id == "relation/1#part"
    assert tower.height == 36.0
    assert tower.building.footprint.area == 64.0
    # Dissolved, the nave and the tower stay two blocks at their own heights.
    assert sorted(h for _, h, _ in dissolve([nave, tower])) == [15.0, 36.0]


def test_tall_parts_skip_flat_buildings_and_others_than_lidar() -> None:
    heights = np.zeros((40, 40))
    heights[2:12, 2:12] = 15.0
    flat = Measured(
        Building("way/1", box(676004.0, 4303976.0, 676024.0, 4303996.0), None), 15.0, "lidar"
    )
    levels = Measured(flat.building, 3.0, "levels")
    assert tall_parts([flat, levels], heights, GRID) == []


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


def part(osm_id: str, footprint: Polygon, height: float = 30.0) -> Measured:
    return Measured(Building(osm_id, footprint, None), height, "lidar-part")


def test_straighten_squares_stepped_parts_but_not_listed_domes_or_ragged_ones(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("solycerveza.buildings.KEEP_SHAPE", frozenset({"way/3#part"}))
    # A 10 m square, turned 30°, with a 2 m step cut from one corner: 96 % of its rectangle.
    stepped = affinity.rotate(Polygon([(0, 0), (10, 0), (10, 8), (8, 8), (8, 10), (0, 10)]), 30)
    # An L: 64 % of its bounding square.
    ragged = Polygon([(0, 0), (10, 0), (10, 4), (4, 4), (4, 10), (0, 10)])
    dome = box(0, 0, 9, 9).buffer(1)
    assert isinstance(stepped, Polygon) and isinstance(dome, Polygon)
    out = straighten(
        [part("way/1#part", stepped), part("way/2#part", ragged), part("way/3#part", dome)]
    )
    assert out[0].building.footprint.area == pytest.approx(100.0)
    assert out[0].height == 30.0
    assert out[1].building.footprint.equals(ragged)
    assert out[2].building.footprint.equals(dome)


def test_straighten_and_crenellate_fail_when_a_listed_part_is_gone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("solycerveza.buildings.KEEP_SHAPE", frozenset({"way/9#part"}))
    monkeypatch.setattr("solycerveza.buildings.CRENELLATED", frozenset({"way/9#part"}))
    with pytest.raises(ValueError, match="way/9#part"):
        straighten([part("way/1#part", box(0, 0, 4, 4))])
    with pytest.raises(ValueError, match="way/9#part"):
        crenellate([part("way/1#part", box(0, 0, 4, 4))])


def test_crenellate_sinks_the_tower_and_stands_merlons_on_its_walls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("solycerveza.buildings.CRENELLATED", frozenset({"way/1#part"}))
    tower = box(0, 0, 12, 12)
    other = part("way/2#part", box(20, 0, 24, 4))
    parts, merlons = crenellate([part("way/1#part", tower, 34.6), other])
    assert parts[1] is other
    top = parts[0].height
    assert top == 33.5 and top % HEIGHT_STEP_M == 0
    assert len(merlons) == 4 * 4  # 10.8 m of wall per side: four merlons each
    for base, height, merlon in merlons:
        assert (base, height) == (top, top + MERLON_HEIGHT_M)
        assert merlon.area == pytest.approx(1.44)
        assert tower.contains(merlon)
        assert merlon.exterior.distance(tower.exterior) == pytest.approx(0.0, abs=1e-9)


def test_drop_canopy_removes_the_listed_parts_and_needs_them_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("solycerveza.buildings.CANOPY_PARTS", frozenset({"way/2#part"}))
    tower = part("way/1#part", box(0, 0, 4, 4))
    canopy = part("way/2#part", box(10, 0, 14, 4), 11.0)
    assert drop_canopy([tower, canopy]) == [tower]
    with pytest.raises(ValueError, match="way/2#part"):
        drop_canopy([tower])

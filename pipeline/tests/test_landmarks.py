import numpy as np
import pytest
from affine import Affine
from pyproj import Transformer
from shapely.geometry import LineString, Polygon, box

from solycerveza.buildings import Building, Measured
from solycerveza.landmarks import (
    ALCAZABA,
    ARCADE_H,
    ESPANTAPERROS,
    LANDMARK_WAYS,
    PLAZA_ALTA,
    PUERTA_DE_PALMAS,
    TOWER_RISE_M,
    WALL_MAX_M,
    alcazaba,
    apply,
    arcades,
    espantaperros,
    merlons_along,
    outlines,
)
from solycerveza.obstacles import Grid

# A 2 m grid in UTM 29N, in Badajoz: 200 x 200 m from (676000, 4304000) down and right.
GRID = Grid("EPSG:25829", Affine(2.0, 0, 676000.0, 0, -2.0, 4304000.0), 100, 100)
X0, Y0 = 676000.0, 4303800.0  # the grid's bottom-left corner
TO_WGS84 = Transformer.from_crs(GRID.crs, "EPSG:4326", always_xy=True)
TO_GRID = Transformer.from_crs("EPSG:4326", GRID.crs, always_xy=True)


def at(x0: float, y0: float, x1: float, y1: float) -> Polygon:
    return box(X0 + x0, Y0 + y0, X0 + x1, Y0 + y1)


def house(osm_id: str, footprint: Polygon, height: float) -> Measured:
    return Measured(Building(osm_id, footprint, None), height, "lidar")


def raster(*areas: tuple[Polygon, float]) -> np.ndarray:
    """Heights on GRID: 0, and each polygon's cells at its height."""
    from rasterio.features import rasterize

    out = np.zeros((GRID.height, GRID.width))
    for geom, h in areas:
        mask = rasterize([(geom, 1)], out_shape=out.shape, transform=GRID.transform)
        out[mask == 1] = h
    return out


def test_merlons_turn_with_the_line_and_stand_at_the_base() -> None:
    line = LineString([(0, 0), (8, 6)])  # 10 m, at an angle
    merlons = merlons_along(line, 12.0)
    assert len(merlons) == 4
    for base, top, merlon in merlons:
        assert (base, top) == (12.0, 13.4)
        assert merlon.area == pytest.approx(1.0)
        assert merlon.centroid.distance(line) == pytest.approx(0.0, abs=1e-9)


def test_outlines_need_every_landmark_closed() -> None:
    def way(osm_id: int, ring: Polygon) -> dict[str, object]:
        xs, ys = ring.exterior.xy
        lons, lats = TO_WGS84.transform(list(xs), list(ys))
        return {
            "type": "way",
            "id": osm_id,
            "geometry": [{"lon": lo, "lat": la} for lo, la in zip(lons, lats, strict=True)],
        }

    data = {"elements": [way(i, at(10, 10, 30, 30)) for i in LANDMARK_WAYS]}
    shapes = outlines(data, TO_GRID)
    assert set(shapes) == set(LANDMARK_WAYS)
    assert shapes[ALCAZABA].area == pytest.approx(400.0, rel=1e-3)
    with pytest.raises(ValueError, match=str(PLAZA_ALTA)):
        outlines({"elements": data["elements"][:3]}, TO_GRID)


def test_alcazaba_walls_towers_and_battlements_but_not_on_taller_houses() -> None:
    # A 100 m square enclosure with a 6 x 6 m tower jutting out of its south side.
    square = at(50, 50, 150, 150)
    tower = at(97, 44, 103, 50)
    joined = square.union(tower)
    walls = square.difference(square.buffer(-3))
    assert isinstance(joined, Polygon) and isinstance(walls, Polygon)
    enclosure = Polygon(joined.exterior.coords)
    heights = raster((walls, 9.0), (tower, 12.0))
    # A 20 m house stands on the middle of the north wall.
    on_wall = house("way/1", at(90, 144, 110, 151), 20.0)
    bands = alcazaba(enclosure, [on_wall], heights, GRID)

    blocks = [(b, t, p) for b, t, p in bands if b == 0.0]
    battlements = [(b, t, p) for b, t, p in bands if b > 0.0]
    assert blocks and battlements
    assert all(5.0 <= t <= WALL_MAX_M + TOWER_RISE_M for _, t, _ in blocks)
    towers = [p for _, t, p in blocks if p.intersects(tower) and p.area > 30]
    assert len(towers) == 1
    # Walls stay inside the outline; a tower overlaps it by its 0.8 m margin at most.
    assert all(enclosure.buffer(1e-6).contains(p) for _, _, p in blocks if p not in towers)
    assert enclosure.buffer(1.2, join_style="mitre").contains(towers[0])
    # No wall under the taller house.
    assert not any(p.intersection(on_wall.building.footprint).area > 2 for _, _, p in blocks)


def test_espantaperros_has_a_body_a_narrower_crown_and_battlements() -> None:
    octagon = at(90, 90, 100, 100).buffer(2, join_style="mitre", quad_segs=1)
    heights = raster((octagon, 27.0))
    bands = espantaperros(octagon, heights, GRID)
    body = [(b, t, p) for b, t, p in bands if b == 0.0]
    assert len(body) == 1 and body[0][1] == 21.0
    crown = [p for b, t, p in bands if (b, t) == (21.0, 26.0)]
    assert len(crown) == 1 and octagon.contains(crown[0]) and crown[0].area < octagon.area
    assert any(b == 26.0 for b, _, _ in bands)  # merlons on the crown


def test_arcades_raise_the_long_sides_houses_on_pillars() -> None:
    plaza = at(40, 80, 120, 110)  # 80 x 30 m
    north = house("way/1", at(60, 110, 80, 125), 12.3)
    east = house("way/2", at(120, 85, 135, 105), 12.0)  # on a short side
    kept, bands = arcades(plaza, [north, east])
    assert kept == [east]
    lifted = [p for b, t, p in bands if (b, t) == (ARCADE_H, 12.5)]
    assert lifted and all(p.bounds[1] == pytest.approx(Y0 + 110) for p in lifted)
    assert sum(p.area for p in lifted) == pytest.approx(20 * 4.0)
    pillars = [p for b, t, p in bands if (b, t) == (0.0, ARCADE_H)]
    assert len(pillars) >= 6
    rest = [p for b, t, p in bands if (b, t) == (0.0, 12.5)]
    assert sum(p.area for p in rest) == pytest.approx(20 * 11.0)


def test_apply_replaces_the_tower_and_the_gate() -> None:
    octagon = at(20, 20, 30, 30)
    gate = house(f"way/{PUERTA_DE_PALMAS}", at(150, 20, 160, 30), 11.8)
    tower = house(f"way/{ESPANTAPERROS}", octagon, 24.0)
    tower_part = house(f"way/{ESPANTAPERROS}#part", octagon.buffer(-2), 27.0)
    other = house("way/7", at(60, 20, 70, 30), 8.0)
    shapes = {
        ALCAZABA: at(40, 40, 140, 140),
        ESPANTAPERROS: octagon,
        PUERTA_DE_PALMAS: gate.building.footprint,
        PLAZA_ALTA: at(0, 180, 30, 190),
    }
    kept, bands = apply([gate, tower, tower_part, other], shapes, raster((octagon, 27.0)), GRID)
    assert kept == [other]
    assert (0.0, 12.0, gate.building.footprint) in bands

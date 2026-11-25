from typing import Any

import numpy as np
from affine import Affine
from shapely.geometry import Polygon

from solycerveza.obstacles import Grid
from solycerveza.trees import (
    UNIT,
    band_polygons,
    crown_cells,
    encode,
    erode,
    opened,
)

# A 2 m grid in UTM 29N, in Badajoz.
GRID = Grid("EPSG:25829", Affine(2.0, 0, 676000.0, 0, -2.0, 4304000.0), 40, 40)


def test_erode_shrinks_and_opened_drops_thin_lines() -> None:
    mask = np.zeros((9, 9), dtype=bool)
    mask[1:6, 1:6] = True  # a 5 x 5 crown
    mask[8, :] = True  # a one-cell wall
    assert erode(mask, 1).sum() == 9
    kept = opened(mask)
    assert kept[1:6, 1:6].all()
    assert not kept[8].any()


def test_crowns_are_tall_and_clear_of_buildings() -> None:
    heights = np.zeros((40, 40))
    heights[5:12, 5:12] = 8.0  # a tree
    heights[25:35, 25:35] = 15.0  # a building
    heights[5:12, 25:32] = 1.5  # a hedge, too low
    structures = np.zeros((40, 40), dtype=bool)
    structures[25:35, 25:35] = True
    crowns = crown_cells(heights, structures)
    assert crowns[5:12, 5:12].all()
    assert not crowns[20:, 20:].any()
    assert not crowns[5:12, 25:32].any()


def test_bands_stack_from_the_ground_up_to_each_crowns_own_height() -> None:
    heights = np.zeros((40, 40))
    heights[5:15, 5:15] = 8.0
    heights[8:12, 8:12] = 14.2
    heights[25:35, 25:35] = 4.0  # a low crown, all in the first band
    bands = band_polygons(heights > 0, heights, GRID)
    assert sorted((base, top) for base, top, _ in bands) == [
        (0.0, 4.0),  # not up to the next band (7 m)
        (0.0, 7.0),
        (4.8, 13.0),  # capped where the band above starts
        (10.0, 14.0),  # its own height, not the tallest cell in the city
    ]


def test_tiny_crowns_are_dropped() -> None:
    heights = np.zeros((40, 40))
    heights[5:7, 5:8] = 6.0  # 2 x 3 cells, 24 m2
    assert band_polygons(heights > 0, heights, GRID) == []


def decode(data: dict[str, Any]) -> list[tuple[float, float, list[list[tuple[float, float]]]]]:
    """What web/src/map/treeCodec.ts does: steps back to closed rings, in degrees."""
    out = []
    first = (0, 0)
    for base, top, polygons in data["g"]:
        for rings in polygons:
            decoded = []
            for steps in rings:
                x, y = first
                ring = []
                for i in range(0, len(steps), 2):
                    x, y = x + steps[i], y + steps[i + 1]
                    if i == 0:
                        first = (x, y)
                    ring.append((x / UNIT, y / UNIT))
                decoded.append([*ring, ring[0]])
            out.append((base, top, decoded))
    return out


def test_encode_groups_by_extrusion_and_round_trips() -> None:
    heights = np.zeros((40, 40))
    heights[5:15, 5:15] = 8.0
    heights[25:35, 5:15] = 3.0
    data = encode(band_polygons(heights > 0, heights, GRID), GRID.crs)
    assert data["v"] == 1
    assert [(base, top, len(polygons)) for base, top, polygons in data["g"]] == [
        (0.0, 4.0, 1),  # at least 1 m above its band's floor
        (0.0, 7.0, 1),
        (4.8, 8.0, 1),
    ]
    assert all(isinstance(v, int) for _, _, ps in data["g"] for p in ps for r in p for v in r)
    for _, _, rings in decode(data):
        lon, lat = rings[0][0]
        assert -7.1 < lon < -6.9 and 38.8 < lat < 38.95
        assert rings[0][0] == rings[0][-1]
        assert Polygon(rings[0]).is_valid


def test_encode_is_deterministic() -> None:
    heights = np.zeros((40, 40))
    heights[5:15, 5:15] = 8.0
    heights[25:35, 25:35] = 8.0
    bands = band_polygons(heights > 0, heights, GRID)
    assert encode(bands, GRID.crs) == encode(list(reversed(bands)), GRID.crs)

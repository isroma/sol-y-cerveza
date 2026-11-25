import numpy as np
from affine import Affine

from solycerveza.obstacles import Grid
from solycerveza.trees import (
    band_polygons,
    crown_cells,
    erode,
    feature_collection,
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


def test_bands_stack_from_the_ground_up() -> None:
    heights = np.zeros((40, 40))
    heights[5:15, 5:15] = 7.0
    heights[8:12, 8:12] = 12.5
    crowns = heights > 0
    bands = band_polygons(crowns, heights, GRID)
    assert [(base, top) for base, top, _ in bands] == [(0.0, 6.0), (4.2, 11.0), (8.5, 17.0)]
    assert bands[0][2].area == bands[1][2].area > bands[2][2].area


def test_feature_collection_is_wgs84_rounded_and_ordered() -> None:
    heights = np.zeros((40, 40))
    heights[5:15, 5:15] = 7.0
    heights[25:35, 5:15] = 3.0
    collection = feature_collection(band_polygons(heights > 0, heights, GRID), GRID.crs)
    features = collection["features"]
    assert [f["properties"]["b"] for f in features] == [0.0, 0.0, 4.2]
    lon, lat = features[0]["geometry"]["coordinates"][0][0]
    assert -7.1 < lon < -6.9 and 38.8 < lat < 38.95
    assert lon == round(lon, 5)

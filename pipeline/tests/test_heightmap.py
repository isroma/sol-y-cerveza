import math
import numpy as np

from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.heightmap import TILE_PX, ZOOM, encode, tile_range, tile_transform


def test_tiles_cover_badajoz() -> None:
    xs, ys = tile_range(BADAJOZ_BBOX)
    west = tile_transform(xs.start, ys.start)
    east = tile_transform(xs.stop - 1, ys.stop - 1)
    # Corners in EPSG:3857 metres, back to degrees of longitude.
    degrees = 180 / (math.pi * 6378137.0)
    assert west.c * degrees <= BADAJOZ_BBOX.west
    assert (east.c + east.a * TILE_PX) * degrees >= BADAJOZ_BBOX.east


def test_pixels_are_about_two_metres_in_badajoz() -> None:
    size = tile_transform(0, 0).a * math.cos(math.radians(38.87))
    assert 1.8 < size < 1.95


def test_encode_packs_surface_and_height_above_ground() -> None:
    dsm = np.array([[173.25, np.nan]])
    dtm = np.array([[172.2, 172.0]])
    rgb = encode(dsm, dtm)
    decimetres = int(rgb[0, 0, 0]) * 256 + int(rgb[0, 0, 1])
    assert decimetres == 1732
    assert rgb[0, 0, 2] == 4  # 1.05 m above the terrain, in quarter metres
    assert rgb[0, 1].tolist() == [0, 0, 0]  # no data


def test_encode_caps_the_height_above_ground() -> None:
    assert encode(np.array([[300.0]]), np.array([[170.0]]))[0, 0, 2] == 255


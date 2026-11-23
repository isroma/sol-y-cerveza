import math
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import pytest
import rasterio
from affine import Affine
from pyproj import Transformer

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox
from solycerveza.horizon import horizon_profile
from solycerveza.leafoff import (
    MAX_SCENES_PER_SEASON,
    MIN_ABOVE_GROUND_M,
    SENTINEL_ATTRIBUTION,
    BandReader,
    Outline,
    S2Window,
    build_leafoff_dsm,
    deciduous_mask,
    dilate,
    leaf_off_surface,
    parse_scene_listing,
    parse_structures,
    s2_window,
    scene_path,
    season_composite,
    structures_mask,
    structures_query,
    write_ndvi,
)
from solycerveza.obstacles import NODATA, Grid, write_raster

GROUND = 180.0
PIXEL = 2.0
SIZE = 101  # the observer stands at the centre of cell (50, 50)
TRANSFORM = Affine.translation(-SIZE, SIZE) @ Affine.scale(PIXEL, -PIXEL)
_ROWS, _COLS = np.mgrid[0:SIZE, 0:SIZE]
XS = -100.0 + PIXEL * _COLS  # cell centres, relative to the observer
YS = 100.0 - PIXEL * _ROWS

SUMMER_GREEN = 0.7
WINTER_BARE = 0.2
WINTER_GREEN = 0.65


def flat() -> npt.NDArray[np.float64]:
    return np.full((SIZE, SIZE), GROUND)


def disc(x: float, y: float, radius: float) -> npt.NDArray[np.bool_]:
    return np.asarray(np.hypot(XS - x, YS - y) <= radius)


def profile(surface: npt.NDArray[Any]) -> list[int]:
    return horizon_profile(np.asarray(surface, dtype=np.float64), TRANSFORM, 0.0, 0.0, GROUND)


# --- deciduous_mask -------------------------------------------------------------------------


def test_deciduous_needs_summer_green_and_a_winter_drop() -> None:
    summer = np.array([0.7, 0.7, 0.3, 0.7, math.nan, 0.7])
    winter = np.array([0.2, 0.65, 0.0, math.nan, 0.2, 0.45])
    # deciduous, evergreen, never green, no winter data, no summer data, a 0.25 drop
    assert deciduous_mask(summer, winter).tolist() == [True, False, False, False, False, True]


# --- dilate ---------------------------------------------------------------------------------


def test_dilate_grows_by_whole_cells_with_diagonals() -> None:
    mask = np.zeros((5, 5), dtype=bool)
    mask[2, 2] = True
    assert dilate(mask, 0).sum() == 1
    assert dilate(mask, 1).sum() == 9
    assert dilate(mask, 2).all()
    edge = np.zeros((3, 3), dtype=bool)
    edge[0, 0] = True
    assert dilate(edge, 1).sum() == 4  # clipped at the border


# --- leaf_off_surface -----------------------------------------------------------------------


def _scene(
    *, crown_evergreen: bool = False
) -> tuple[
    npt.NDArray[np.float64],
    npt.NDArray[np.float64],
    npt.NDArray[np.bool_],
    npt.NDArray[np.bool_],
]:
    """A terrace with a tree crown 6 m to its south, a wall 30 m to its north and a building
    under a second crown 20 m to its east. Sentinel-2 sees green summer canopy over both crowns
    and the building (a 10 m pixel mixes them)."""
    dsm = flat()
    crown = disc(0, -6, 3)
    dsm[crown] = GROUND + 8
    wall = (YS >= 30) & (YS < 34) & (np.abs(XS) <= 20)
    dsm[wall] = GROUND + 15
    building = (np.abs(XS - 20) <= 4) & (np.abs(YS) <= 4)
    dsm[building] = GROUND + 10
    building_crown = disc(20, 0, 7) & ~building
    dsm[building_crown] = GROUND + 9
    dtm = flat()
    structures = wall | building
    summer = np.full((SIZE, SIZE), 0.1)
    winter = np.full((SIZE, SIZE), 0.1)
    canopy = crown | disc(20, 0, 7)
    summer[canopy] = SUMMER_GREEN
    winter[canopy] = WINTER_GREEN if crown_evergreen else WINTER_BARE
    return dsm, dtm, structures, deciduous_mask(summer, winter)


def test_a_bare_crown_next_to_the_terrace_is_lowered_to_the_ground() -> None:
    dsm, dtm, structures, deciduous = _scene()
    surface, lowered = leaf_off_surface(dsm, dtm, structures, deciduous)

    assert surface.dtype == np.float32
    crown = disc(0, -6, 3)
    assert lowered[crown].all()
    assert (surface[crown] == GROUND).all()

    full, winter = profile(dsm), profile(surface)
    assert full[180] > 400  # the crown, 8 m tall 3 m away
    assert winter[180] == 0  # due south is open once the tree is bare
    assert winter[0] == full[0] > 0  # the wall to the north stays


def test_an_evergreen_crown_stays() -> None:
    dsm, dtm, structures, deciduous = _scene(crown_evergreen=True)
    surface, lowered = leaf_off_surface(dsm, dtm, structures, deciduous)
    assert not lowered.any()
    assert profile(surface) == profile(dsm)


def test_buildings_are_never_lowered_even_under_a_bare_crown() -> None:
    dsm, dtm, structures, deciduous = _scene()
    building = (np.abs(XS - 20) <= 4) & (np.abs(YS) <= 4)
    assert deciduous[building].all()  # Sentinel-2 alone would remove it

    surface, lowered = leaf_off_surface(dsm, dtm, structures, deciduous)
    assert not lowered[structures].any()
    assert (surface[structures] == dsm[structures]).all()
    # The building still blocks the east, at least as much as it would on its own.
    building_only = np.where(building, dsm, dtm)
    assert profile(surface)[90] >= profile(building_only)[90] > 0


def test_cells_next_to_a_building_are_kept_as_a_buffer() -> None:
    dsm, dtm, structures, deciduous = _scene()
    _, lowered = leaf_off_surface(dsm, dtm, structures, deciduous)
    ring = dilate(structures, 1) & ~structures
    assert not lowered[ring].any()
    crown_beyond = disc(20, 0, 7) & ~dilate(structures, 1)
    assert lowered[crown_beyond].all()


def test_low_vegetation_and_nodata_are_left_alone() -> None:
    dsm = flat()
    dsm[0, 0] = GROUND + MIN_ABOVE_GROUND_M - 0.01
    dsm[0, 1] = NODATA
    dsm[0, 2] = math.nan
    dtm = flat()
    dtm[0, 3] = NODATA
    dsm[0, 3] = GROUND + 10
    everywhere = np.ones((SIZE, SIZE), dtype=bool)
    surface, lowered = leaf_off_surface(dsm, dtm, ~everywhere, everywhere)
    assert not lowered[0, :4].any()
    assert surface[0, 1] == NODATA
    assert math.isnan(surface[0, 2])
    assert surface[0, 3] == GROUND + 10


def test_inputs_must_share_a_grid() -> None:
    with pytest.raises(ValueError, match="one grid"):
        leaf_off_surface(
            flat(), flat()[:-1], np.zeros((SIZE, SIZE), bool), np.zeros((SIZE, SIZE), bool)
        )


# --- Structures -----------------------------------------------------------------------------


def _ring(lon: float, lat: float, d: float) -> list[dict[str, float]]:
    corners = [(lon, lat), (lon + d, lat), (lon + d, lat + d), (lon, lat + d), (lon, lat)]
    return [{"lon": x, "lat": y} for x, y in corners]


def test_structures_query_asks_for_geometry_of_buildings_and_walls() -> None:
    query = structures_query(BADAJOZ_BBOX)
    assert 'way["building"]' in query
    assert 'way["building:part"]' in query
    assert "city_wall" in query
    assert 'relation["building"]' in query
    assert query.endswith("out geom;\n")


def test_parse_structures_reads_ways_and_relation_members() -> None:
    data = {
        "elements": [
            {"type": "way", "id": 1, "geometry": _ring(-6.97, 38.88, 0.0001)},
            {"type": "way", "id": 2, "geometry": [{"lon": -6.97, "lat": 38.88}]},  # degenerate
            {
                "type": "relation",
                "id": 3,
                "members": [
                    {"type": "way", "role": "outer", "geometry": _ring(-6.96, 38.88, 0.0002)},
                    {"type": "node", "role": "", "lat": 38.0, "lon": -6.0},
                ],
            },
            {"type": "node", "id": 4, "lat": 38.88, "lon": -6.97},
        ]
    }
    outlines = parse_structures(data)
    assert len(outlines) == 2
    assert all(outline.closed for outline in outlines)


def _grid_around(lat: float, lon: float, cells: int = 40) -> Grid:
    x, y = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True).transform(lon, lat)
    left = math.floor(x / PIXEL) * PIXEL - cells // 2 * PIXEL
    top = math.floor(y / PIXEL) * PIXEL + cells // 2 * PIXEL
    return Grid("EPSG:25829", Affine(PIXEL, 0, left, 0, -PIXEL, top), cells, cells)


def test_structures_mask_fills_polygons_and_traces_walls() -> None:
    lat, lon = 38.88, -6.97
    grid = _grid_around(lat, lon)
    # A ~17 m x 22 m building whose corner is at the grid centre, and an open wall line.
    building = Outline(tuple((p["lon"], p["lat"]) for p in _ring(lon, lat, 0.0002)))
    wall = Outline(((lon - 0.0003, lat - 0.0002), (lon - 0.0001, lat - 0.0002)))
    assert building.closed
    assert not wall.closed

    mask = structures_mask([building, wall], grid)
    assert mask.shape == (grid.height, grid.width)
    assert mask[12, 25]  # inside the building, NE of the centre
    assert not mask[30, 30]  # open ground
    wall_cells = int(mask[29:33, :].sum())
    assert 7 <= wall_cells <= 14  # ~17 m of wall, one or two cells thick
    assert not structures_mask([], grid).any()


# --- Sentinel-2 -----------------------------------------------------------------------------

LISTING = """<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<Prefix>sentinel-s2-l2a-cogs/29/S/PD/2025/1/</Prefix>
<CommonPrefixes><Prefix>sentinel-s2-l2a-cogs/29/S/PD/2025/1/S2B_29SPD_20250115_0_L2A/</Prefix>
</CommonPrefixes>
<CommonPrefixes><Prefix>sentinel-s2-l2a-cogs/29/S/PD/2025/1/S2A_29SPD_20250113_0_L2A/</Prefix>
</CommonPrefixes>
<CommonPrefixes><Prefix>sentinel-s2-l2a-cogs/29/S/PD/2025/1/notes/</Prefix></CommonPrefixes>
</ListBucketResult>"""


def test_parse_scene_listing_keeps_scene_ids_sorted() -> None:
    assert parse_scene_listing(LISTING) == [
        "S2A_29SPD_20250113_0_L2A",
        "S2B_29SPD_20250115_0_L2A",
    ]


def test_scene_path_uses_unpadded_month() -> None:
    assert (
        scene_path("S2C_29SPD_20250722_0_L2A")
        == "sentinel-s2-l2a-cogs/29/S/PD/2025/7/S2C_29SPD_20250722_0_L2A"
    )
    with pytest.raises(ValueError):
        scene_path("S2A_30STJ_20250722_0_L2A")


def test_s2_window_snaps_to_20_m_and_covers_the_bbox() -> None:
    window = s2_window(BADAJOZ_BBOX)
    for edge in (window.left, window.bottom, window.right, window.top):
        assert edge % 20 == 0
    rows, cols = window.shape
    assert 900 < rows < 950  # ~9 km at 10 m
    assert 1000 < cols < 1100  # ~10.5 km
    assert window.transform.a == 10.0


SMALL = S2Window(left=0, bottom=0, right=40, top=20)  # 2 x 4 pixels


def _reader(scenes: dict[str, dict[str, list[list[float]]]]) -> BandReader:
    def read(scene: str, band: str, window: S2Window) -> npt.NDArray[np.float64]:
        assert window == SMALL
        return np.array(scenes[scene][band], dtype=np.float64)

    return read


def _scene_bands(ndvi: float, scl: list[list[float]]) -> dict[str, list[list[float]]]:
    red = 1000.0
    nir = red * (1 + ndvi) / (1 - ndvi)
    return {"SCL": scl, "B04": [[red] * 4] * 2, "B08": [[nir] * 4] * 2}


CLEAR: list[list[float]] = [[4, 5, 6, 4]] * 2
ONE_CLOUD: list[list[float]] = [[4, 9, 4, 4], [4, 4, 4, 4]]  # 7/8 clear: below the threshold
HALF_CLEAR: list[list[float]] = [[4, 4, 4, 4], [8, 8, 8, 8]]


def test_season_composite_takes_the_median_of_clear_scenes() -> None:
    scenes = {
        "S2A_29SPD_20250101_0_L2A": _scene_bands(0.6, CLEAR),
        "S2A_29SPD_20250102_0_L2A": _scene_bands(0.2, CLEAR),
        "S2A_29SPD_20250103_0_L2A": _scene_bands(0.4, CLEAR),
        "S2A_29SPD_20250104_0_L2A": _scene_bands(0.9, ONE_CLOUD),
        "S2A_29SPD_20250105_0_L2A": _scene_bands(0.9, HALF_CLEAR),
    }
    median, used = season_composite(sorted(scenes), SMALL, _reader(scenes))
    assert used == [
        "S2A_29SPD_20250101_0_L2A",
        "S2A_29SPD_20250102_0_L2A",
        "S2A_29SPD_20250103_0_L2A",
    ]
    assert median.shape == (2, 4)
    np.testing.assert_allclose(median, 0.4)


def test_season_composite_masks_cloudy_pixels_and_keeps_at_most_the_cap() -> None:
    cloudy_corner: list[list[float]] = [[4, 4, 4, 4], [4, 4, 4, 4]]
    scenes = {
        f"S2A_29SPD_202501{day:02d}_0_L2A": _scene_bands(0.1 * day % 0.9, cloudy_corner)
        for day in range(1, MAX_SCENES_PER_SEASON + 3)
    }
    _, used = season_composite(sorted(scenes), SMALL, _reader(scenes))
    assert len(used) == MAX_SCENES_PER_SEASON
    # All equally clear: the earliest win, so reruns choose the same scenes.
    assert used == sorted(scenes)[:MAX_SCENES_PER_SEASON]


def test_season_composite_needs_a_clear_scene() -> None:
    scenes = {"S2A_29SPD_20250101_0_L2A": _scene_bands(0.5, HALF_CLEAR)}
    with pytest.raises(ValueError, match="clear"):
        season_composite(sorted(scenes), SMALL, _reader(scenes))


# --- The whole step on small rasters ---------------------------------------------------------

# Plaza Alta; the grids below are built around it.
LAT, LON = 38.88256, -6.96976


def test_build_leafoff_dsm_lowers_only_bare_crowns_away_from_buildings(tmp_path: Path) -> None:
    grid = _grid_around(LAT, LON, cells=60)  # 120 m x 120 m, 2 m cells
    rows, cols = np.mgrid[0 : grid.height, 0 : grid.width]
    dsm = np.full((grid.height, grid.width), GROUND, dtype=np.float32)
    dtm = dsm.copy()
    west_crown = np.hypot(rows - 30, cols - 15) <= 4
    east_building = (np.abs(rows - 30) <= 3) & (np.abs(cols - 45) <= 3)
    dsm[west_crown] = GROUND + 9
    dsm[east_building] = GROUND + 12
    dsm[0, 0] = NODATA
    write_raster(tmp_path / "dsm.tif", dsm, grid, "MDS")
    write_raster(tmp_path / "dtm.tif", dtm, grid, "MDT")

    # Sentinel-2: the whole area is green in summer and bare in winter, buildings included.
    to_s2 = Transformer.from_crs("EPSG:4326", "EPSG:32629", always_xy=True)
    x, y = to_s2.transform(LON, LAT)
    window = S2Window(
        left=math.floor(x / 20) * 20 - 200,
        bottom=math.floor(y / 20) * 20 - 200,
        right=math.floor(x / 20) * 20 + 200,
        top=math.floor(y / 20) * 20 + 200,
    )
    shape = window.shape
    ndvi = tmp_path / "ndvi.tif"
    write_ndvi(ndvi, np.full(shape, SUMMER_GREEN), np.full(shape, WINTER_BARE), window, ["a", "b"])

    # The building's footprint in WGS84, from the grid's cell corners.
    to_wgs = Transformer.from_crs("EPSG:25829", "EPSG:4326", always_xy=True)
    corners = [
        grid.transform @ (c, r) for c, r in [(42, 27), (49, 27), (49, 34), (42, 34), (42, 27)]
    ]
    footprint = Outline(tuple(to_wgs.transform(cx, cy) for cx, cy in corners))

    out = tmp_path / "leafoff.tif"
    lowered = build_leafoff_dsm(
        tmp_path / "dsm.tif", tmp_path / "dtm.tif", ndvi, [footprint], out, year=2025
    )
    with rasterio.open(out) as dataset:
        surface = dataset.read(1)
        assert dataset.tags()["SOURCE"] == SENTINEL_ATTRIBUTION.format(year=2025)
        assert dataset.transform == grid.transform

    assert lowered == int(west_crown.sum())
    assert (surface[west_crown] == GROUND).all()
    assert (surface[east_building] == GROUND + 12).all()
    assert surface[0, 0] == NODATA


def test_build_leafoff_dsm_rejects_rasters_on_different_grids(tmp_path: Path) -> None:
    grid = _grid_around(LAT, LON, cells=10)
    other = _grid_around(LAT, LON, cells=12)
    write_raster(tmp_path / "dsm.tif", np.zeros((10, 10), np.float32), grid, "MDS")
    write_raster(tmp_path / "dtm.tif", np.zeros((12, 12), np.float32), other, "MDT")
    with pytest.raises(ValueError, match="share one grid"):
        build_leafoff_dsm(
            tmp_path / "dsm.tif",
            tmp_path / "dtm.tif",
            tmp_path / "ndvi.tif",
            [],
            tmp_path / "out.tif",
            year=2025,
        )


def test_s2_window_of_a_small_bbox_is_whole_20_m_cells() -> None:
    small = BoundingBox(south=38.88, west=-6.97, north=38.881, east=-6.969)
    rows, cols = s2_window(small).shape
    assert rows % 2 == 0
    assert cols % 2 == 0
    assert rows >= 12  # ~111 m north to south

from pathlib import Path

import numpy as np
import numpy.typing as npt
import pytest
import rasterio
from affine import Affine
from pyproj import Transformer

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox
from solycerveza.obstacles import (
    MDS05_WCS,
    NODATA,
    TARGET_CRS,
    Grid,
    grid_for_bbox,
    main,
    mosaic,
    multipart_files,
    sheets_for_bbox,
    wcs_subset,
    write_raster,
)

# Badajoz cathedral, in WGS84 and in ETRS89 / UTM 29N.
CATHEDRAL_LON, CATHEDRAL_LAT = -6.9697, 38.8784
CATHEDRAL_X, CATHEDRAL_Y = Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True).transform(
    CATHEDRAL_LON, CATHEDRAL_LAT
)


def write_tile(
    path: Path,
    data: npt.NDArray[np.float32],
    left: float,
    top: float,
    res: float,
    crs: str = TARGET_CRS,
    nodata: float | None = None,
) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[1],
        height=data.shape[0],
        count=1,
        dtype="float32",
        crs=crs,
        transform=Affine(res, 0.0, left, 0.0, -res, top),
        nodata=nodata,
    ) as dst:
        dst.write(data, 1)
    return path


def small_grid(left: float, top: float, width: int, height: int, res: float = 2.0) -> Grid:
    return Grid(TARGET_CRS, Affine(res, 0.0, left, 0.0, -res, top), width, height)


# Sheet selection


def test_badajoz_needs_the_two_extended_badajoz_sheets() -> None:
    assert sheets_for_bbox(BADAJOZ_BBOX) == ["0775-2", "0775-4"]


@pytest.mark.parametrize(
    ("bbox", "expected"),
    [
        # Old town only: one sheet.
        (BoundingBox(south=38.87, west=-6.98, north=38.89, east=-6.96), ["0775-4"]),
        # Straddles the four-sheet corner east of the city.
        (
            BoundingBox(south=38.9, west=-6.9, north=38.93, east=-6.8),
            sorted(["0775-2", "0775-4", "0776-1", "0776-3"]),
        ),
        # Ends exactly on the 0775/0776 edge: touching doesn't count.
        (BoundingBox(south=38.85, west=-6.95, north=38.9, east=-6.854167), ["0775-4"]),
        # Portuguese side north of the city: no Spanish sheet.
        (BoundingBox(south=38.95, west=-7.2, north=38.99, east=-7.1), []),
    ],
)
def test_sheets_for_bbox(bbox: BoundingBox, expected: list[str]) -> None:
    assert sheets_for_bbox(bbox) == expected


def test_sheets_for_bbox_rejects_bbox_beyond_known_sheets() -> None:
    with pytest.raises(ValueError, match="beyond the known sheets"):
        sheets_for_bbox(BoundingBox(south=38.8, west=-7.0, north=39.2, east=-6.9))


# Target grid


def test_grid_for_bbox_snaps_outwards_and_covers_the_bbox() -> None:
    grid = grid_for_bbox(BADAJOZ_BBOX, resolution=2.0)
    left, bottom, right, top = grid.bounds
    assert grid.crs == "EPSG:25829"
    assert grid.transform.a == 2.0 and grid.transform.e == -2.0
    assert left % 2 == 0 and top % 2 == 0
    transformer = Transformer.from_crs("EPSG:4326", TARGET_CRS, always_xy=True)
    for lon in (BADAJOZ_BBOX.west, BADAJOZ_BBOX.east):
        for lat in (BADAJOZ_BBOX.south, BADAJOZ_BBOX.north):
            x, y = transformer.transform(lon, lat)
            assert left <= x <= right and bottom <= y <= top
    # About 10.6 km x 9.1 km.
    assert 5300 <= grid.width <= 5310 and 4550 <= grid.height <= 4560


# Mosaic, crop, reproject


def test_mosaic_joins_adjacent_tiles_and_crops(tmp_path: Path) -> None:
    west = write_tile(tmp_path / "a.tif", np.full((10, 10), 1.0, np.float32), 1000, 2000, 2.0)
    east = write_tile(tmp_path / "b.tif", np.full((10, 10), 2.0, np.float32), 1020, 2000, 2.0)
    # Spans the seam and reaches past both tiles (y 1980-2000) to the east and south.
    grid = small_grid(left=1010, top=1990, width=20, height=8)

    out = mosaic([east, west], grid)

    assert out.dtype == np.float32
    np.testing.assert_array_equal(out[:5, :5], 1.0)
    np.testing.assert_array_equal(out[:5, 5:15], 2.0)
    np.testing.assert_array_equal(out[:, 15:], NODATA)  # east of both tiles
    np.testing.assert_array_equal(out[5:, :], NODATA)  # south of both tiles


def test_mosaic_copies_aligned_cells_exactly(tmp_path: Path) -> None:
    data = np.arange(100, dtype=np.float32).reshape(10, 10)
    tile = write_tile(tmp_path / "t.tif", data, 1000, 2000, 2.0)
    grid = small_grid(left=1004, top=1994, width=4, height=3)

    np.testing.assert_array_equal(mosaic([tile], grid), data[3:6, 2:6])


def test_mosaic_fills_nodata_from_the_next_tile(tmp_path: Path) -> None:
    first = np.full((4, 4), 5.0, np.float32)
    first[:, :2] = -32767
    a = write_tile(tmp_path / "a.tif", first, 1000, 2000, 2.0, nodata=-32767)
    b = write_tile(tmp_path / "b.tif", np.full((4, 4), 7.0, np.float32), 1000, 2000, 2.0)

    out = mosaic([b, a], small_grid(1000, 2000, 4, 4))

    np.testing.assert_array_equal(out[:, :2], 7.0)  # a's nodata, filled from b
    np.testing.assert_array_equal(out[:, 2:], 5.0)  # a wins where both have data


def test_mosaic_reprojects_utm30_to_utm29(tmp_path: Path) -> None:
    # A 5 m tile in UTM 30N, like the IGN WCS output, with a 15 m wide "tower" on the cathedral.
    x30, y30 = Transformer.from_crs("EPSG:4326", "EPSG:25830", always_xy=True).transform(
        CATHEDRAL_LON, CATHEDRAL_LAT
    )
    data = np.full((200, 200), 180.0, np.float32)
    data[99:102, 99:102] = 220.0
    left, top = x30 - 100 * 5 - 2.5, y30 + 100 * 5 + 2.5  # cell (100, 100) centred on it
    tile = write_tile(tmp_path / "utm30.tif", data, left, top, 5.0, crs="EPSG:25830")
    grid = small_grid(
        left=round(CATHEDRAL_X) - 200, top=round(CATHEDRAL_Y) + 200, width=200, height=200
    )

    out = mosaic([tile], grid)

    assert (out != NODATA).all()
    tower = np.argwhere(out == 220.0)
    assert 15 <= len(tower) <= 70  # 225 m² is about 56 cells of 4 m², give or take the edges
    row, col = tower.mean(axis=0)
    x, y = grid.transform @ (col + 0.5, row + 0.5)
    assert abs(x - CATHEDRAL_X) < 5 and abs(y - CATHEDRAL_Y) < 5


def test_write_raster_round_trip(tmp_path: Path) -> None:
    grid = small_grid(1000, 2000, 3, 2)
    data = np.array([[1.5, 2.5, NODATA], [4.0, 5.0, 6.0]], np.float32)
    path = tmp_path / "out" / "dsm.tif"

    write_raster(path, data, grid, source="test source")

    with rasterio.open(path) as src:
        assert src.crs.to_epsg() == 25829
        assert src.transform == grid.transform
        assert src.nodata == NODATA
        assert src.tags()["SOURCE"] == "test source"
        np.testing.assert_array_equal(src.read(1), data)


# WCS request and response


def test_wcs_subset_covers_the_rotated_target_grid() -> None:
    grid = grid_for_bbox(BADAJOZ_BBOX, resolution=2.0)

    left, bottom, right, top = wcs_subset(MDS05_WCS, grid)

    to_utm30 = Transformer.from_crs(TARGET_CRS, MDS05_WCS.crs, always_xy=True)
    grid_left, grid_bottom, grid_right, grid_top = grid.bounds
    for x in (grid_left, grid_right):
        for y in (grid_bottom, grid_top):
            x30, y30 = to_utm30.transform(x, y)
            assert left < x30 < right and bottom < y30 < top


def test_multipart_files_extracts_grid_and_prj() -> None:
    body = (
        b"\r\n--wcs\r\nContent-Type: application/asc\r\nContent-Transfer-Encoding: binary\r\n"
        b"Content-ID: coverage/out.asc\r\nContent-Disposition: INLINE; filename=out.asc\r\n\r\n"
        b"ncols 2\nnrows 1\nxllcorner 0\nyllcorner 0\ncellsize 5\n 170.199 170.043\n"
        b"\r\n--wcs\r\nContent-Type: application/octet-stream\r\n"
        b"Content-Disposition: INLINE; filename=out.prj\r\n\r\n"
        b'PROJCS["ETRS89_UTM_zone_30N"]'
        b"\r\n--wcs--\r\n"
    )

    files = multipart_files("multipart/related; boundary=wcs", body)

    assert files["out.asc"].endswith(b" 170.199 170.043\n")
    assert files["out.prj"] == b'PROJCS["ETRS89_UTM_zone_30N"]'


# Command line


def test_main_explains_the_manual_download_when_tiles_are_missing(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    code = main(["--dsm-dir", str(tmp_path / "mds02"), "--dtm-dir", str(tmp_path / "mdt02")])

    assert code == 2
    err = capsys.readouterr().err
    assert "0775-2, 0775-4" in err
    assert "--source wcs" in err


def test_main_builds_dsm_and_dtm_on_one_grid_from_local_tiles(tmp_path: Path) -> None:
    grid = grid_for_bbox(BADAJOZ_BBOX, resolution=100.0)
    left, top = grid.transform.c - 1000, grid.transform.f + 1000
    shape = (grid.height + 20, grid.width + 20)
    for kind, height in (("mds02", 190.0), ("mdt02", 180.0)):
        (tmp_path / kind).mkdir()
        write_tile(
            tmp_path / kind / "tile.TIF", np.full(shape, height, np.float32), left, top, 100.0
        )

    code = main(
        [
            "--dsm-dir", str(tmp_path / "mds02"),
            "--dtm-dir", str(tmp_path / "mdt02"),
            "--out-dir", str(tmp_path / "out"),
            "--resolution", "100",
        ]
    )  # fmt: skip

    assert code == 0
    with (
        rasterio.open(tmp_path / "out" / "badajoz_dsm.tif") as dsm,
        rasterio.open(tmp_path / "out" / "badajoz_dtm.tif") as dtm,
    ):
        assert dsm.crs == dtm.crs and dsm.crs.to_epsg() == 25829
        assert dsm.transform == dtm.transform == grid.transform
        assert dsm.shape == dtm.shape == (grid.height, grid.width)
        np.testing.assert_array_equal(dsm.read(1) - dtm.read(1), 10.0)
        assert "MDS02" in dsm.tags()["SOURCE"] and "MDT02" in dtm.tags()["SOURCE"]

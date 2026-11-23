import json
from pathlib import Path

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer

from solycerveza.trees import crown_radius, detect, find_peaks, render


def ground(size: int = 21) -> np.ndarray:
    return np.zeros((size, size))


def test_a_crown_is_a_tree() -> None:
    height = ground()
    y, x = np.mgrid[:21, :21]
    dome = 9.0 - 0.6 * ((y - 10) ** 2 + (x - 10) ** 2) ** 0.5
    height = np.maximum(height, dome)
    assert find_peaks(height) == [(10, 10)]


def test_flat_roofs_and_ridges_are_not() -> None:
    roof = ground()
    roof[4:16, 4:16] = 12.0
    assert find_peaks(roof) == []
    ridge = ground()
    for col in range(21):
        ridge[8:13, col] = [10.0, 11.0, 12.0, 11.0, 10.0]
    assert find_peaks(ridge) == []


def test_low_shrubs_and_no_data_are_ignored() -> None:
    shrub = ground()
    shrub[10, 10] = 2.0
    assert find_peaks(shrub) == []
    hole = ground()
    hole[10, 10] = np.nan
    assert find_peaks(hole) == []


def test_crown_radius_grows_with_height_within_bounds() -> None:
    assert crown_radius(2.0) == 1.5
    assert crown_radius(10.0) == 3.5
    assert crown_radius(40.0) == 6.0


def test_render_is_valid_json_with_attribution() -> None:
    data = json.loads(render([(-6.97, 38.88, 9.5, 3.4)]))
    assert data["version"] == 1
    assert data["trees"] == [[-6.97, 38.88, 9.5, 3.4]]
    assert any("MDS02" in line for line in data["attribution"])
    assert json.loads(render([]))["trees"] == []


def test_detect_reads_rasters_and_keeps_trees_near_terraces(tmp_path: Path) -> None:
    size = 41
    transform = Affine(2.0, 0, 680_000.0, 0, -2.0, 4_305_000.0)  # 2 m grid, UTM 29N
    y, x = np.mgrid[:size, :size]
    crown = np.maximum(0.0, 9.0 - 0.6 * ((y - 20) ** 2 + (x - 20) ** 2) ** 0.5)
    paths = {}
    for name, grid in (("dsm", 180.0 + crown), ("dtm", np.full((size, size), 180.0))):
        paths[name] = tmp_path / f"{name}.tif"
        with rasterio.open(
            paths[name],
            "w",
            driver="GTiff",
            height=size,
            width=size,
            count=1,
            dtype="float32",
            crs="EPSG:25829",
            transform=transform,
            nodata=-9999.0,
        ) as out:
            out.write(grid.astype("float32"), 1)
    to_wgs = Transformer.from_crs("EPSG:25829", "EPSG:4326", always_xy=True)
    centre = to_wgs.transform(*(transform @ (20.5, 20.5)))
    far = to_wgs.transform(*(transform @ (20.5, 20.5) + np.array([5_000.0, 0.0])))

    trees = detect(paths["dsm"], paths["dtm"], [centre])
    assert len(trees) == 1
    lon, lat, height, radius = trees[0]
    assert (round(lon, 5), round(lat, 5)) == (round(centre[0], 5), round(centre[1], 5))
    assert height == 9.0
    assert radius == round(crown_radius(9.0), 1)
    assert detect(paths["dsm"], paths["dtm"], [far]) == []

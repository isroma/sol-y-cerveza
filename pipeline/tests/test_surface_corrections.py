import json
from pathlib import Path

import numpy as np
import pytest
from affine import Affine
from pyproj import Transformer
from shapely.geometry import box, mapping

from solycerveza.surface_corrections import (
    CORRECTIONS_PATH,
    areas,
    flatten,
    load_corrections,
)

CRS = "EPSG:25829"
TO_WGS84 = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)
# A 2 m grid, 10 x 10 cells, from (676000, 4304000) down and right.
TRANSFORM = Affine(2.0, 0, 676000.0, 0, -2.0, 4304000.0)


def wgs84_box(x0: float, y0: float, x1: float, y1: float) -> object:
    (a, c), (b, d) = TO_WGS84.transform([x0, x1], [y0, y1])
    return mapping(box(a, b, c, d))


def write(tmp_path: Path, features: list[dict[str, object]]) -> Path:
    path = tmp_path / "corrections.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


def feature(kind: str, geometry: object, reason: str = "checked") -> dict[str, object]:
    return {"type": "Feature", "properties": {"kind": kind, "reason": reason}, "geometry": geometry}


def test_the_repo_file_loads() -> None:
    corrections = load_corrections(CORRECTIONS_PATH)
    assert {c.kind for c in corrections} == {"ground", "structure"}
    assert all(c.reason for c in corrections)


def test_load_needs_a_kind_a_reason_and_a_polygon(tmp_path: Path) -> None:
    area = wgs84_box(676004, 4303984, 676010, 4303990)
    with pytest.raises(ValueError, match="kind"):
        load_corrections(write(tmp_path, [feature("lake", area)]))
    with pytest.raises(ValueError, match="reason"):
        load_corrections(write(tmp_path, [feature("ground", area, reason="")]))
    line = {"type": "LineString", "coordinates": [[-6.97, 38.88], [-6.96, 38.88]]}
    with pytest.raises(ValueError, match="polygon"):
        load_corrections(write(tmp_path, [feature("ground", line)]))


def test_flatten_sets_the_surface_to_the_terrain_inside_ground_areas_only(
    tmp_path: Path,
) -> None:
    path = write(
        tmp_path,
        [
            feature("ground", wgs84_box(676004.5, 4303984.5, 676009.5, 4303989.5)),
            feature("structure", wgs84_box(676012, 4303992, 676016, 4303996)),
        ],
    )
    corrections = load_corrections(path)
    ground = areas(corrections, "ground", CRS)
    assert len(ground) == 1 and len(areas(corrections, "structure", CRS)) == 1

    terrain = np.full((10, 10), 160.0, dtype=np.float32)
    surface = np.full((10, 10), 241.0, dtype=np.float32)  # an 81 m block everywhere
    terrain[0, 0] = -9999.0  # no terrain here: left as it is
    out, changed = flatten(surface, terrain, ground, TRANSFORM, -9999.0)
    inside = out == 160.0
    assert changed == int(inside.sum()) > 0
    # Only the cells round the ground area (rows and columns 5-7 of the grid).
    rows, cols = np.nonzero(inside)
    assert rows.min() >= 5 and rows.max() <= 7 and cols.min() >= 2 and cols.max() <= 4
    assert out[0, 0] == 241.0
    assert surface[5, 3] == 241.0  # the input is not changed


def test_flatten_without_areas_changes_nothing() -> None:
    surface = np.ones((3, 3), dtype=np.float32)
    out, changed = flatten(surface, surface * 0, [], TRANSFORM, -9999.0)
    assert changed == 0 and out is surface

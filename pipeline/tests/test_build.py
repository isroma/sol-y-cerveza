import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pydantic import ValidationError
from rasterio.transform import from_origin

from solycerveza.build import (
    PNOA_ATTRIBUTION,
    TerracesFile,
    add_horizons,
    attribution_lines,
    height_above_ground,
    position_warnings,
    raster_attribution,
    render,
)
from solycerveza.terraces import Terrace
from solycerveza.venues import LatLon


def _terrace(terrace_id: str = "curated:plaza-alta") -> Terrace:
    point = LatLon(lat=38.88256, lon=-6.96976)
    return Terrace(
        id=terrace_id,
        name="Plaza Alta",
        kind="bar",
        venue=point,
        terrace=point,
        sources=["curated"],
        verified=None,
    )


def _file(terraces: list[Terrace]) -> TerracesFile:
    return TerracesFile(
        generated=datetime(2026, 11, 22, 18, 30, 5, 123, tzinfo=UTC),
        sample=False,
        attribution=["© OpenStreetMap contributors (ODbL)"],
        terraces=terraces,
    )


def test_add_horizons_computes_at_the_terrace_position() -> None:
    seen: list[tuple[float, float]] = []

    def horizon_for(lat: float, lon: float) -> list[int]:
        seen.append((lat, lon))
        return [10] * 360

    (result,) = add_horizons([_terrace()], horizon_for)

    assert seen == [(38.88256, -6.96976)]
    assert result.horizon == [10] * 360


def test_add_horizons_rejects_a_malformed_profile() -> None:
    with pytest.raises(ValidationError):
        add_horizons([_terrace()], lambda _lat, _lon: [10] * 359)


def test_render_follows_the_contract_layout() -> None:
    terrace = add_horizons([_terrace()], lambda _lat, _lon: list(range(360)))[0]
    text = render(_file([terrace]))

    assert text.endswith("}\n")
    horizon_lines = [line for line in text.splitlines() if '"horizon"' in line]
    assert horizon_lines == ['      "horizon": [' + ",".join(map(str, range(360))) + "]"]
    data = json.loads(text)
    assert list(data) == ["version", "generated", "sample", "attribution", "terraces"]
    assert data["version"] == 2
    assert data["generated"] == "2026-11-22T18:30:05Z"
    assert list(data["terraces"][0]) == [
        "id",
        "name",
        "kind",
        "venue",
        "terrace",
        "sources",
        "verified",
        "horizon",
    ]


def test_render_keeps_a_null_horizon() -> None:
    data = json.loads(render(_file([_terrace()])))
    assert data["terraces"][0]["horizon"] is None


def test_generated_is_written_in_utc() -> None:
    madrid_winter = timezone(timedelta(hours=1))
    file = _file([]).model_copy(
        update={"generated": datetime(2026, 11, 22, 19, 0, tzinfo=madrid_winter)}
    )
    assert json.loads(render(file))["generated"] == "2026-11-22T18:00:00Z"


def test_render_is_deterministic() -> None:
    terraces = add_horizons([_terrace()], lambda _lat, _lon: [5] * 360)
    assert render(_file(terraces)) == render(_file(terraces))


def _raster(path: Path, tags: dict[str, str], value: float = 0.0) -> Path:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=2,
        height=2,
        count=1,
        dtype="float32",
        crs="EPSG:25829",
        transform=from_origin(0, 2, 1, 1),
        nodata=-9999.0,
    ) as dst:
        dst.write(np.full((2, 2), value, dtype=np.float32), 1)
        dst.update_tags(**tags)
    return path


# A 40 m x 40 m raster in EPSG:25829 around the Plaza Alta test terrace.
def _local_raster(path: Path, value: float, nodata: bool = False) -> Path:
    from pyproj import Transformer

    x, y = Transformer.from_crs("EPSG:4326", "EPSG:25829", always_xy=True).transform(
        -6.96976, 38.88256
    )
    data = np.full((20, 20), -9999.0 if nodata else value, dtype=np.float32)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=20,
        height=20,
        count=1,
        dtype="float32",
        crs="EPSG:25829",
        transform=from_origin(x - 20, y + 20, 2, 2),
        nodata=-9999.0,
    ) as dst:
        dst.write(data, 1)
        dst.update_tags(SOURCE="test")
    return path


def test_height_above_ground_is_surface_minus_terrain(tmp_path: Path) -> None:
    dsm = _local_raster(tmp_path / "dsm.tif", 210.0)
    dtm = _local_raster(tmp_path / "dtm.tif", 200.0)
    assert height_above_ground(38.88256, -6.96976, dsm, dtm) == pytest.approx(10.0)


def test_height_above_ground_is_none_without_data(tmp_path: Path) -> None:
    dsm = _local_raster(tmp_path / "dsm.tif", 0.0, nodata=True)
    dtm = _local_raster(tmp_path / "dtm.tif", 200.0)
    assert height_above_ground(38.88256, -6.96976, dsm, dtm) is None
    assert height_above_ground(38.9, -6.9, dtm, dtm) is None  # outside the raster


def test_position_warnings_flag_points_on_roofs(tmp_path: Path) -> None:
    dtm = _local_raster(tmp_path / "dtm.tif", 200.0)
    roof = _local_raster(tmp_path / "roof.tif", 209.0)
    street = _local_raster(tmp_path / "street.tif", 200.5)

    (warning,) = position_warnings([_terrace()], roof, dtm)
    assert "curated:plaza-alta" in warning
    assert "9.0 m above the ground" in warning
    assert position_warnings([_terrace()], street, dtm) == []


def test_attribution_credits_pnoa_only_for_curated_positions(tmp_path: Path) -> None:
    dsm = _raster(tmp_path / "dsm.tif", {"SOURCE": "MDS"})
    dtm = _raster(tmp_path / "dtm.tif", {"SOURCE": "MDT"})
    osm_only = _terrace("osm:node/1").model_copy(update={"sources": ["osm"]})

    assert attribution_lines([osm_only], dsm, dtm) == [
        "© OpenStreetMap contributors (ODbL)",
        "MDS",
        "MDT",
    ]
    assert attribution_lines([_terrace()], dsm, dtm)[-1] == PNOA_ATTRIBUTION


def test_raster_attribution_reads_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {"SOURCE": "Obra derivada de MDS05"})
    assert raster_attribution(path) == "Obra derivada de MDS05"


def test_raster_attribution_requires_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {})
    with pytest.raises(ValueError, match="SOURCE"):
        raster_attribution(path)

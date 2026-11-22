import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pydantic import ValidationError
from rasterio.transform import from_origin

from solycerveza.build import TerracesFile, add_horizons, raster_attribution, render
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
    assert data["version"] == 1
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


def _raster(path: Path, tags: dict[str, str]) -> Path:
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
    ) as dst:
        dst.write(np.zeros((2, 2), dtype=np.float32), 1)
        dst.update_tags(**tags)
    return path


def test_raster_attribution_reads_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {"SOURCE": "Obra derivada de MDS05"})
    assert raster_attribution(path) == "Obra derivada de MDS05"


def test_raster_attribution_requires_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {})
    with pytest.raises(ValueError, match="SOURCE"):
        raster_attribution(path)

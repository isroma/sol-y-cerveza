import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest
import rasterio
from pydantic import ValidationError
from rasterio.transform import from_origin

from solycerveza.build import (
    OUTPUT,
    PNOA_ATTRIBUTION,
    TerracesFile,
    add_horizons,
    attribution_lines,
    height_above_ground,
    position_warnings,
    raster_attribution,
    render,
)
from solycerveza.prices import PRICES_CSV, prices_by_venue, read_prices
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
    assert horizon_lines == ['      "horizon": [' + ",".join(map(str, range(360))) + "],"]
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
        "horizon_winter",
        "prices",
    ]


def test_add_horizons_keeps_a_winter_horizon_only_where_it_differs() -> None:
    plaza = _terrace("curated:plaza-alta")
    street = _terrace("curated:calle").model_copy(
        update={"terrace": LatLon(lat=38.877, lon=-6.9705)}
    )
    no_terrace = _terrace("osm:node/1").model_copy(update={"terrace": None, "sources": ["osm"]})

    def winter_for(lat: float, _lon: float) -> list[int]:
        # Bare trees open up the plaza; the street is walled by buildings either way.
        return [3] * 360 if lat > 38.88 else [10] * 360

    result = add_horizons([plaza, street, no_terrace], lambda _lat, _lon: [10] * 360, winter_for)
    assert [t.horizon_winter for t in result] == [[3] * 360, None, None]
    assert result[2].horizon is None


def test_add_horizons_without_a_leaf_off_model_has_no_winter_horizons() -> None:
    (result,) = add_horizons([_terrace()], lambda _lat, _lon: [10] * 360)
    assert result.horizon_winter is None


def test_a_winter_horizon_needs_a_horizon() -> None:
    with pytest.raises(ValidationError, match="horizon_winter needs a horizon"):
        Terrace.model_validate({**_terrace().model_dump(), "horizon_winter": [0] * 360})


def test_render_puts_the_winter_horizon_on_one_line() -> None:
    terrace = add_horizons(
        [_terrace()], lambda _lat, _lon: [9] * 360, lambda _lat, _lon: [1] * 360
    )[0]
    lines = render(_file([terrace])).splitlines()
    assert '      "horizon_winter": [' + ",".join(["1"] * 360) + "]," in lines


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


def test_attribution_credits_pnoa_for_curated_and_review_positions(tmp_path: Path) -> None:
    dsm = _raster(tmp_path / "dsm.tif", {"SOURCE": "MDS"})
    dtm = _raster(tmp_path / "dtm.tif", {"SOURCE": "MDT"})
    osm_only = _terrace("osm:node/1").model_copy(update={"sources": ["osm"]})

    assert attribution_lines([osm_only], dsm, dtm) == [
        "© OpenStreetMap contributors (ODbL)",
        "MDS",
        "MDT",
    ]
    assert attribution_lines([_terrace()], dsm, dtm)[-1] == PNOA_ATTRIBUTION
    # Admin pins with no curated terrace left still need the credit (#264).
    review_only = _terrace("osm:node/2").model_copy(update={"sources": ["osm", "review"]})
    assert attribution_lines([osm_only, review_only], dsm, dtm)[-1] == PNOA_ATTRIBUTION


def test_attribution_credits_sentinel_only_when_winter_horizons_exist(tmp_path: Path) -> None:
    dsm = _raster(tmp_path / "dsm.tif", {"SOURCE": "MDS"})
    dtm = _raster(tmp_path / "dtm.tif", {"SOURCE": "MDT"})
    leafoff = _raster(tmp_path / "leafoff.tif", {"SOURCE": "Copernicus"})
    osm = _terrace("osm:node/1").model_copy(update={"sources": ["osm"]})
    (with_winter,) = add_horizons([osm], lambda _a, _b: [9] * 360, lambda _a, _b: [1] * 360)
    (same,) = add_horizons([osm], lambda _a, _b: [9] * 360, lambda _a, _b: [9] * 360)

    assert attribution_lines([with_winter], dsm, dtm, leafoff)[-1] == "Copernicus"
    assert "Copernicus" not in attribution_lines([same], dsm, dtm, leafoff)
    assert "Copernicus" not in attribution_lines([with_winter], dsm, dtm)


def test_raster_attribution_reads_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {"SOURCE": "Obra derivada de MDS05"})
    assert raster_attribution(path) == "Obra derivada de MDS05"


def test_raster_attribution_requires_the_source_tag(tmp_path: Path) -> None:
    path = _raster(tmp_path / "dsm.tif", {})
    with pytest.raises(ValueError, match="SOURCE"):
        raster_attribution(path)


def test_shipped_terraces_json_is_valid_and_rendered_by_the_pipeline() -> None:
    text = OUTPUT.read_text(encoding="utf-8")
    shipped = TerracesFile.model_validate_json(text)
    assert render(shipped) == text, "terraces.json was edited by hand: rebuild it"


def test_shipped_terraces_json_has_the_prices_in_venue_prices_csv() -> None:
    shipped = TerracesFile.model_validate_json(OUTPUT.read_text(encoding="utf-8"))
    expected = prices_by_venue(read_prices(PRICES_CSV), {t.id for t in shipped.terraces})
    wrong = sorted(t.id for t in shipped.terraces if t.prices != expected.get(t.id, []))
    assert wrong == [], "venue_prices.csv changed without a rebuild of terraces.json"


def _ring_horizon(lat: float, _lon: float) -> list[int]:
    """The pin sees 100 everywhere, the points north of it 300 and those south 50."""
    if lat > 38.88257:
        return [300] * 360
    if lat < 38.88255:
        return [50] * 360
    return [100] * 360


def _points(lat: float, lon: float) -> list[tuple[float, float]]:
    return [(lat, lon), (lat + 0.00003, lon), (lat - 0.00003, lon)]


def test_add_horizons_sets_the_envelope_over_the_ground_points() -> None:
    (result,) = add_horizons([_terrace()], _ring_horizon, points_for=_points)
    assert result.horizon == [100] * 360
    assert result.horizon_low == [50] * 360
    assert result.horizon_high == [300] * 360
    assert result.horizon_low_winter is None


def test_add_horizons_leaves_out_an_envelope_every_point_agrees_with() -> None:
    (result,) = add_horizons([_terrace()], lambda _a, _b: [7] * 360, points_for=_points)
    assert result.horizon_low is None and result.horizon_high is None


def test_add_horizons_without_ground_points_has_no_envelope() -> None:
    (result,) = add_horizons([_terrace()], _ring_horizon, points_for=lambda _a, _b: [])
    assert result.horizon_low is None


def test_add_horizons_keeps_a_winter_envelope_only_where_it_differs() -> None:
    def bare(lat: float, lon: float) -> list[int]:
        return [max(0, v - 40) for v in _ring_horizon(lat, lon)]

    (same,) = add_horizons([_terrace()], _ring_horizon, _ring_horizon, _points)
    (open_,) = add_horizons([_terrace()], _ring_horizon, bare, _points)

    assert same.horizon_low_winter is None
    assert open_.horizon_low_winter == [10] * 360
    assert open_.horizon_high_winter == [260] * 360


def test_an_envelope_needs_both_halves_in_order() -> None:
    base = {**_terrace().model_dump(), "horizon": [5] * 360}
    with pytest.raises(ValidationError, match="both its low and its high"):
        Terrace.model_validate({**base, "horizon_low": [0] * 360})
    with pytest.raises(ValidationError, match="must not exceed"):
        Terrace.model_validate({**base, "horizon_low": [9] * 360, "horizon_high": [1] * 360})


def test_render_leaves_out_null_envelopes_and_puts_envelopes_on_one_line() -> None:
    with_envelope = add_horizons([_terrace()], _ring_horizon, points_for=_points)[0]
    without = add_horizons([_terrace("curated:calle")], lambda _a, _b: [1] * 360)[0]
    text = render(_file([without, with_envelope]))
    data = json.loads(text)
    assert "horizon_low" not in data["terraces"][0]
    assert list(data["terraces"][1])[7:11] == [
        "horizon",
        "horizon_winter",
        "horizon_low",
        "horizon_high",
    ]
    assert '      "horizon_high": [' + ",".join(["300"] * 360) + "]," in text.splitlines()
    assert render(TerracesFile.model_validate_json(text)) == text

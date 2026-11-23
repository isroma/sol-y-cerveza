import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from pydantic import ValidationError

from solycerveza import terraces
from solycerveza.terraces import (
    CURATED_COLUMNS,
    CURATED_CSV,
    CuratedTerrace,
    Terrace,
    build_terraces,
    read_curated,
    write_terraces,
)
from solycerveza.venues import LatLon, Venue, parse_venues

# Recorded from overpass-api.de on 2026-11-22 and trimmed by hand. © OpenStreetMap contributors.
FIXTURE = Path(__file__).parent / "fixtures" / "overpass_venues.json"
HEADER = ",".join(CURATED_COLUMNS)

# What the fixture holds, by role in these tests.
VELADOR = "osm:node/9384007214"  # outdoor_seating=yes
PANECAFE = "osm:node/12949582124"  # outdoor_seating=yes
JUEVES = "osm:node/6350940394"  # outdoor_seating=no
LUGARIS = "osm:way/551282200"  # no outdoor_seating tag
UNNAMED_WAY = "osm:way/564742757"  # no name, no outdoor_seating tag


def fixture_venues() -> list[Venue]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return parse_venues(data)


def curated_csv(tmp_path: Path, *rows: str) -> Path:
    path = tmp_path / "curated.csv"
    path.write_text("\n".join([HEADER, *rows]) + "\n", encoding="utf-8")
    return path


def curated(**fields: str | float) -> CuratedTerrace:
    return CuratedTerrace.model_validate(
        {"id": "prueba", "terrace_lat": 38.88, "terrace_lon": -6.97, **fields}
    )


def test_shipped_curated_list_is_valid_and_says_where_each_row_comes_from() -> None:
    rows = read_curated(CURATED_CSV)
    assert all(row.notes for row in rows), "every curated row needs notes with its evidence"


def test_read_curated_parses_rows_and_treats_empty_cells_as_unset(tmp_path: Path) -> None:
    path = curated_csv(
        tmp_path,
        f"terraza-linked,{LUGARIS},,,38.8838501,-6.9877,2026-11-01,"
        " EXP-2025/0042 ,  junto a la fuente  ",
        "terraza-sola,,Terraza de prueba,bar,38.88,-6.97,,,",
    )

    linked, alone = read_curated(path)

    assert linked == CuratedTerrace(
        id="terraza-linked",
        osm_id=LUGARIS,
        terrace_lat=38.88385,
        terrace_lon=-6.9877,
        verified=date(2026, 11, 1),
        ayto_ref="EXP-2025/0042",
        notes="junto a la fuente",
    )
    assert alone.name == "Terraza de prueba"
    assert alone.kind == "bar"
    assert alone.osm_id is None
    assert alone.verified is None


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("sin-osm,,,bar,38.88,-6.97,,,", "name and kind are required"),
        ("sin-osm,,Terraza,,38.88,-6.97,,,", "name and kind are required"),
        ("Mal Slug,,Terraza,bar,38.88,-6.97,,,", "\nid\n"),
        ("x,node/1,,,38.88,-6.97,,,", "\nosm_id\n"),
        ("x,,Terraza,disco,38.88,-6.97,,,", "\nkind\n"),
        ("x,,Terraza,bar,,-6.97,,", "\nterrace_lat\n"),
        ("x,,Terraza,bar,91,-6.97,,", "\nterrace_lat\n"),
        ("x,,Terraza,bar,38.88,-6.97,22/11/2026,,", "\nverified\n"),
        ("x,,Terraza,bar,38.88,-6.97,,,,extra", "more cells than columns"),
    ],
)
def test_read_curated_rejects_invalid_rows_with_line_number(
    tmp_path: Path, row: str, message: str
) -> None:
    path = curated_csv(tmp_path, "ok,,Terraza,bar,38.88,-6.97,,,", row)
    with pytest.raises(ValueError, match=rf"curated.csv:3: (?s:.*){message}"):
        read_curated(path)


def test_read_curated_rejects_an_unexpected_header(tmp_path: Path) -> None:
    path = tmp_path / "curated.csv"
    path.write_text("id,name,lat,lon\n", encoding="utf-8")
    with pytest.raises(ValueError, match="header must be"):
        read_curated(path)


@pytest.mark.parametrize(
    ("rows", "message"),
    [
        (("a,,T,bar,38.88,-6.97,,,", "a,,U,bar,38.87,-6.96,,,"), "duplicate id: a"),
        ((f"a,{JUEVES},,,38.88,-6.97,,,", f"b,{JUEVES},,,38.87,-6.96,,,"), "duplicate osm_id"),
        (("a,,T,bar,38.88,-6.97,,R1,", "b,,U,bar,38.87,-6.96,,R1,"), "duplicate ayto_ref: R1"),
    ],
)
def test_read_curated_rejects_duplicates(
    tmp_path: Path, rows: tuple[str, ...], message: str
) -> None:
    with pytest.raises(ValueError, match=message):
        read_curated(curated_csv(tmp_path, *rows))


def test_every_named_venue_gets_a_record_and_outdoor_seating_a_terrace() -> None:
    records = build_terraces(fixture_venues(), [])

    assert [record.id for record in records] == [PANECAFE, JUEVES, VELADOR, LUGARIS]
    by_id = {record.id: record for record in records}
    assert by_id[JUEVES].terrace is None  # outdoor_seating=no
    assert by_id[LUGARIS].terrace is None  # no outdoor_seating tag
    velador = by_id[VELADOR]
    assert velador == Terrace(
        id=VELADOR,
        name="Café Bar El Velador",
        kind="cafe",
        venue=LatLon(lat=38.882512, lon=-6.995107),
        terrace=LatLon(lat=38.882512, lon=-6.995107),
        sources=["osm"],
        verified=None,
    )
    assert velador.horizon is None


def test_curated_row_links_a_venue_and_its_position_wins() -> None:
    row = curated(osm_id=LUGARIS, terrace_lat=38.88385, terrace_lon=-6.9877, verified="2026-11-01")

    (record,) = [r for r in build_terraces(fixture_venues(), [row]) if r.id == LUGARIS]

    assert record == Terrace(
        id=LUGARIS,
        name="Lugaris",
        kind="restaurant",
        venue=LatLon(lat=38.88399, lon=-6.987658),
        terrace=LatLon(lat=38.88385, lon=-6.9877),
        sources=["curated", "osm"],
        verified=date(2026, 11, 1),
    )


def test_curated_name_and_kind_override_osm() -> None:
    row = curated(osm_id=VELADOR, name="El Velador", kind="bar")

    (record,) = [r for r in build_terraces(fixture_venues(), [row]) if r.id == VELADOR]

    assert (record.name, record.kind, record.sources) == ("El Velador", "bar", ["curated", "osm"])


def test_curated_row_wins_over_outdoor_seating_no() -> None:
    ids = [record.id for record in build_terraces(fixture_venues(), [curated(osm_id=JUEVES)])]
    assert JUEVES in ids


def test_unlinked_curated_row_gets_a_curated_id_and_no_osm_source() -> None:
    row = curated(id="terraza-sola", name="Terraza de prueba", kind="bar", verified="2026-10-30")

    records = build_terraces(fixture_venues(), [row])

    assert [record.id for record in records] == [
        "curated:terraza-sola",
        PANECAFE,
        JUEVES,
        VELADOR,
        LUGARIS,
    ]
    assert records[0] == Terrace(
        id="curated:terraza-sola",
        name="Terraza de prueba",
        kind="bar",
        venue=LatLon(lat=38.88, lon=-6.97),
        terrace=LatLon(lat=38.88, lon=-6.97),
        sources=["curated"],
        verified=date(2026, 10, 30),
    )


def test_link_to_a_venue_missing_from_osm_is_an_error() -> None:
    with pytest.raises(ValueError, match=r"missing from OSM: osm:node/1$"):
        build_terraces(fixture_venues(), [curated(osm_id="osm:node/1")])


def test_linked_venue_without_a_name_needs_a_curated_name() -> None:
    with pytest.raises(ValueError, match="has no name"):
        build_terraces(fixture_venues(), [curated(osm_id=UNNAMED_WAY)])

    named = curated(osm_id=UNNAMED_WAY, name="Terraza de prueba")
    assert UNNAMED_WAY in [record.id for record in build_terraces(fixture_venues(), [named])]


def test_unnamed_osm_terrace_without_curated_row_is_skipped() -> None:
    venue = Venue(
        id="osm:node/1",
        name=None,
        kind="bar",
        location=LatLon(lat=38.88, lon=-6.97),
        outdoor_seating="yes",
    )
    assert build_terraces([venue], []) == []


def test_terrace_model_accepts_a_full_horizon() -> None:
    base = build_terraces(fixture_venues(), [])[0].model_dump()
    assert Terrace.model_validate({**base, "horizon": [900] * 360}).horizon == [900] * 360


@pytest.mark.parametrize(
    "bad",
    [
        {"horizon": [0] * 359},
        {"horizon": [901] * 360},
        {"id": "osm:relation/1"},
        {"kind": "disco"},
        {"sources": []},
    ],
)
def test_terrace_model_rejects_what_the_contract_forbids(bad: dict[str, object]) -> None:
    base = build_terraces(fixture_venues(), [])[0].model_dump()
    with pytest.raises(ValidationError):
        Terrace.model_validate({**base, **bad})


def test_written_file_follows_the_contract_and_is_deterministic(tmp_path: Path) -> None:
    rows = [curated(osm_id=LUGARIS, verified="2026-11-01"), curated(id="b", name="T", kind="pub")]
    first, second = tmp_path / "first.json", tmp_path / "second.json"

    write_terraces(build_terraces(fixture_venues(), rows), first)
    write_terraces(build_terraces(reversed(fixture_venues()), reversed(rows)), second)

    text = first.read_text(encoding="utf-8")
    assert text == second.read_text(encoding="utf-8")
    assert text.endswith("]\n")
    assert '"name": "Café Bar El Velador"' in text  # UTF-8, not \u escapes
    records = json.loads(text)
    assert [record["id"] for record in records] == ["curated:b", PANECAFE, JUEVES, VELADOR, LUGARIS]
    assert records[2]["terrace"] is None
    assert list(records[4]) == [
        "id",
        "name",
        "kind",
        "venue",
        "terrace",
        "sources",
        "verified",
        "horizon",
    ]
    assert records[4]["verified"] == "2026-11-01"
    assert records[4]["horizon"] is None


def test_cli_writes_terraces_base_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(terraces, "CACHE_DIR", tmp_path)
    monkeypatch.setattr(terraces, "load_venues", lambda refresh: fixture_venues())
    monkeypatch.setattr(terraces, "read_curated", lambda: [])

    assert terraces.main([]) == 0

    records = json.loads((tmp_path / "terraces_base.json").read_text(encoding="utf-8"))
    assert [record["id"] for record in records] == [PANECAFE, JUEVES, VELADOR, LUGARIS]


def test_ayto_ref_is_not_exported(tmp_path: Path) -> None:
    rows = read_curated(curated_csv(tmp_path, "solo,,Terraza,bar,38.88,-6.97,,EXP-1,"))
    (terrace,) = build_terraces([], rows)
    assert "ayto_ref" not in terrace.model_dump()


def test_a_venue_without_terrace_cannot_have_terrace_data() -> None:
    base: dict[str, object] = {
        "id": "osm:node/1",
        "name": "Bar",
        "kind": "bar",
        "venue": {"lat": 38.88, "lon": -6.97},
        "terrace": None,
        "sources": ["osm"],
        "verified": None,
    }
    assert Terrace.model_validate(base).horizon is None
    with pytest.raises(ValidationError, match="must be null when terrace is null"):
        Terrace.model_validate({**base, "horizon": [0] * 360})
    with pytest.raises(ValidationError, match="must be null when terrace is null"):
        Terrace.model_validate({**base, "verified": "2026-11-01"})

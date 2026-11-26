import logging
from datetime import UTC, datetime
from pathlib import Path

import pytest

from solycerveza.sun_corrections import (
    SUN_CORRECTIONS_CSV,
    SunCorrection,
    SunReport,
    cap_tenths,
    horizon_bin,
    read_sun_reports,
    sun_corrections_by_venue,
)

HEADER = "id,venue_id,leaf_off,azimuth,altitude,seen\n"
GENERATED = datetime(2026, 11, 26, 12, 0, tzinfo=UTC)
VENUE = "osm:node/123"


def _report(
    azimuth: float,
    altitude: float,
    *,
    report_id: int = 1,
    venue_id: str = VENUE,
    leaf_off: bool = False,
    seen: datetime = datetime(2026, 11, 25, 12, 31, 4, tzinfo=UTC),
) -> SunReport:
    return SunReport(
        id=report_id,
        venue_id=venue_id,
        leaf_off=leaf_off,
        azimuth=azimuth,
        altitude=altitude,
        seen=seen,
    )


def _runs(reports: list[SunReport]) -> list[tuple[bool, int, int, int]]:
    by_venue = sun_corrections_by_venue(reports, {VENUE: True}, GENERATED)
    return [(c.leaf_off, c.from_, c.to, c.altitude) for c in by_venue.get(VENUE, [])]


def test_shipped_sun_corrections_are_valid() -> None:
    read_sun_reports(SUN_CORRECTIONS_CSV)


def test_read_sun_reports_parses_rows_and_sorts_by_id(tmp_path: Path) -> None:
    path = tmp_path / "sun.csv"
    path.write_text(
        HEADER
        + "12,osm:node/123,0,176.3,27.1,2026-11-25T12:31:04.000Z\n"
        + "3,review:bar-pepe,1,200,30.5,2026-01-10T13:00:00.000Z\n",
        encoding="utf-8",
    )
    first, second = read_sun_reports(path)
    assert (first.id, first.venue_id, first.leaf_off) == (3, "review:bar-pepe", True)
    assert (second.azimuth, second.altitude) == (176.3, 27.1)
    assert second.seen == datetime(2026, 11, 25, 12, 31, 4, tzinfo=UTC)


def test_read_sun_reports_without_a_file_is_empty(tmp_path: Path) -> None:
    assert read_sun_reports(tmp_path / "missing.csv") == []


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("0,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z", "id"),
        ("x,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z", "id"),
        ("1,nowhere,0,176.3,27.1,2026-11-25T12:31:04.000Z", "venue_id"),
        ("1,osm:node/1,2,176.3,27.1,2026-11-25T12:31:04.000Z", "leaf_off"),
        ("1,osm:node/1,true,176.3,27.1,2026-11-25T12:31:04.000Z", "leaf_off"),
        ("1,osm:node/1,0,360,27.1,2026-11-25T12:31:04.000Z", "azimuth"),
        ("1,osm:node/1,0,nan,27.1,2026-11-25T12:31:04.000Z", "azimuth"),
        ("1,osm:node/1,0,176.3,91,2026-11-25T12:31:04.000Z", "altitude"),
        ("1,osm:node/1,0,176.3,,2026-11-25T12:31:04.000Z", "altitude"),
        ("1,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04", "seen"),
        ("1,osm:node/1,0,176.3,27.1,yesterday", "seen"),
        ("1,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z,extra", "more cells"),
    ],
)
def test_read_sun_reports_rejects_bad_rows(tmp_path: Path, row: str, message: str) -> None:
    path = tmp_path / "sun.csv"
    path.write_text(HEADER + row + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        read_sun_reports(path)


def test_read_sun_reports_rejects_a_wrong_header_and_duplicate_ids(tmp_path: Path) -> None:
    path = tmp_path / "sun.csv"
    path.write_text("id,venue_id,azimuth,altitude,seen\n", encoding="utf-8")
    with pytest.raises(ValueError, match="header"):
        read_sun_reports(path)
    row = "7,osm:node/1,0,176.3,27.1,2026-11-25T12:31:04.000Z\n"
    path.write_text(HEADER + row + row, encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate id: 7"):
        read_sun_reports(path)


def test_cap_takes_the_margin_off_and_floors_tenths() -> None:
    assert cap_tenths(27.1) == 251  # not 250 through binary rounding
    assert cap_tenths(27.19) == 251
    assert cap_tenths(30.0) == 280
    assert cap_tenths(1.5) == 0


def test_horizon_bin_rounds_halves_up_and_wraps() -> None:
    assert horizon_bin(176.3) == 176
    assert horizon_bin(176.5) == 177
    assert horizon_bin(359.6) == 0


def test_a_report_caps_the_bins_within_the_spread() -> None:
    assert _runs([_report(176.3, 27.1)]) == [(False, 171, 181, 251)]


def test_the_lowest_altitude_sets_a_bin_and_splits_the_runs() -> None:
    runs = _runs([_report(176.3, 27.1, report_id=1), _report(180, 20.0, report_id=2)])
    assert runs == [(False, 171, 174, 251), (False, 175, 185, 180)]


def test_equal_caps_merge_and_a_gap_splits() -> None:
    same = [_report(100, 30, report_id=1), _report(110, 30, report_id=2)]
    assert _runs(same) == [(False, 95, 115, 280)]
    apart = [_report(100, 30, report_id=1), _report(112, 30, report_id=2)]
    assert _runs(apart) == [(False, 95, 105, 280), (False, 107, 117, 280)]


def test_a_run_across_north_is_one_run() -> None:
    assert _runs([_report(358, 30)]) == [(False, 353, 3, 280)]
    assert _runs([_report(2, 30)]) == [(False, 357, 7, 280)]


def test_runs_meet_at_north_only_with_the_same_cap() -> None:
    split = _runs([_report(5, 20, report_id=1), _report(354, 30, report_id=2)])
    assert split == [(False, 0, 10, 180), (False, 349, 359, 280)]
    joined = _runs([_report(0, 30, report_id=1), _report(357, 20, report_id=2)])
    assert joined == [(False, 3, 5, 280), (False, 352, 2, 180)]


def test_seasons_are_apart_and_summer_comes_first() -> None:
    runs = _runs([_report(100, 30, leaf_off=True, report_id=1), _report(200, 40, report_id=2)])
    assert runs == [(False, 195, 205, 380), (True, 95, 105, 280)]


def test_reports_older_than_the_window_are_ignored() -> None:
    edge = datetime(2025, 11, 26, 12, 0, tzinfo=UTC)  # exactly 365 days before
    older = datetime(2025, 11, 26, 11, 59, 59, tzinfo=UTC)
    assert _runs([_report(100, 30, seen=edge)]) == [(False, 95, 105, 280)]
    assert _runs([_report(100, 30, seen=older)]) == []


def test_unknown_venues_and_venues_without_a_horizon_are_ignored(
    caplog: pytest.LogCaptureFixture,
) -> None:
    reports = [
        _report(100, 30, report_id=1),
        _report(100, 30, report_id=2, venue_id="osm:node/9"),
        _report(100, 30, report_id=3, venue_id="osm:way/5"),
    ]
    with caplog.at_level(logging.WARNING):
        result = sun_corrections_by_venue(reports, {VENUE: True, "osm:way/5": False}, GENERATED)
    assert list(result) == [VENUE]
    assert "osm:node/9: no such venue" in caplog.text
    assert "osm:way/5: the venue has no horizon" in caplog.text


def test_venues_come_out_in_id_order_whatever_the_row_order() -> None:
    reports = [
        _report(100, 30, report_id=1, venue_id="osm:node/2"),
        _report(100, 30, report_id=2, venue_id="osm:node/1"),
    ]
    known = {"osm:node/1": True, "osm:node/2": True}
    result = sun_corrections_by_venue(reports, known, GENERATED)
    assert list(result) == ["osm:node/1", "osm:node/2"]
    assert result == sun_corrections_by_venue(reports[::-1], known, GENERATED)


def test_a_correction_serializes_with_the_contract_keys() -> None:
    correction = SunCorrection(leaf_off=False, from_=171, to=181, altitude=251)
    assert correction.model_dump(mode="json") == {
        "leaf_off": False,
        "from": 171,
        "to": 181,
        "altitude": 251,
    }
    assert SunCorrection.model_validate({"leaf_off": False, "from": 1, "to": 2, "altitude": 3})

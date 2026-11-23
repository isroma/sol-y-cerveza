from pathlib import Path

import pytest

from solycerveza.corrections import CORRECTIONS_CSV, Correction, apply_corrections, read_corrections
from solycerveza.venues import LatLon, Venue


def venue(venue_id: str) -> Venue:
    return Venue(
        id=venue_id,
        name="Bar",
        kind="bar",
        location=LatLon(lat=38.88, lon=-6.97),
        outdoor_seating=None,
    )


def test_shipped_corrections_are_valid() -> None:
    assert all(c.notes for c in read_corrections(CORRECTIONS_CSV))


def test_drop_removes_the_venue_and_ignores_unknown_ids(caplog: pytest.LogCaptureFixture) -> None:
    venues = [venue("osm:node/1"), venue("overture:abc")]
    corrections = [
        Correction(venue_id="overture:abc", action="drop", notes="misplaced"),
        Correction(venue_id="overture:gone", action="drop", notes="closed"),
    ]
    assert [v.id for v in apply_corrections(venues, corrections)] == ["osm:node/1"]
    assert "overture:gone" in caplog.text


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("overture:abc,move,somewhere", "action"),
        ("overture:abc,drop,", "notes"),
        ("google:abc,drop,why", "venue_id"),
    ],
)
def test_read_corrections_rejects_bad_rows(tmp_path: Path, row: str, message: str) -> None:
    path = tmp_path / "corrections.csv"
    path.write_text(f"venue_id,action,notes\n{row}\n", encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        read_corrections(path)

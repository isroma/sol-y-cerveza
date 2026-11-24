from datetime import date
from pathlib import Path

import pytest

from solycerveza.review import REVIEW_CSV, Review, read_review, review_terraces, review_venues
from solycerveza.terraces import Terrace, build_terraces
from solycerveza.venues import LatLon, Venue

DAY = date(2026, 11, 23)
HEADER = "venue_id,status,name,kind,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed\n"


def venue(venue_id: str) -> Venue:
    return Venue(
        id=venue_id,
        name="Bar",
        kind="bar",
        location=LatLon(lat=38.88, lon=-6.97),
        outdoor_seating=None,
    )


def record(venue_id: str, terrace: LatLon | None) -> Terrace:
    return Terrace(
        id=venue_id,
        name="Bar",
        kind="bar",
        venue=LatLon(lat=38.88, lon=-6.97),
        terrace=terrace,
        sources=["osm"],
        verified=None,
    )


def test_shipped_reviews_are_valid() -> None:
    assert read_review(REVIEW_CSV), "pipeline/data/venue_review.csv is missing or empty"


def test_missing_file_means_no_reviews(tmp_path: Path) -> None:
    assert read_review(tmp_path / "none.csv") == []


def test_read_review_parses_rows(tmp_path: Path) -> None:
    path = tmp_path / "review.csv"
    path.write_text(
        HEADER
        + "osm:node/1,terrace,,,,,38.881,-6.971,2026-11-23\n"
        + "overture:abc,,,,38.882,-6.972,,,2026-11-23\n",
        encoding="utf-8",
    )
    first, second = read_review(path)
    assert first.status == "terrace"
    assert first.terrace == LatLon(lat=38.881, lon=-6.971)
    assert first.venue is None
    assert second.status is None
    assert second.venue == LatLon(lat=38.882, lon=-6.972)


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("osm:node/1,no_terrace,,,,,38.8,-6.9,2026-11-23", "status terrace"),
        ("osm:node/1,terrace,,,38.8,,,,2026-11-23", "together"),
        ("osm:node/1,,,,,,,,2026-11-23", "status or a venue position"),
        ("osm:node/1,maybe,,,,,,,2026-11-23", "status"),
        ("google:1,terrace,,,,,,,2026-11-23", "venue_id"),
        ("osm:node/1,terrace,Bar,bar,,,,,2026-11-23", "only for added"),
        ("review:bar-x,terrace,Bar X,,38.8,-6.9,,,2026-11-23", "needs a name"),
        ("review:bar-x,not_venue,Bar X,bar,38.8,-6.9,,,2026-11-23", "delete the row"),
    ],
)
def test_read_review_rejects_bad_rows(tmp_path: Path, row: str, message: str) -> None:
    path = tmp_path / "review.csv"
    path.write_text(HEADER + row + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        read_review(path)


def test_read_review_rejects_duplicates(tmp_path: Path) -> None:
    path = tmp_path / "review.csv"
    row = "osm:node/1,no_terrace,,,,,,,2026-11-23\n"
    path.write_text(HEADER + row + row, encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        read_review(path)


def test_review_drops_and_moves_venues() -> None:
    reviews = [
        Review(venue_id="osm:node/1", status="not_venue", reviewed=DAY),
        Review(venue_id="osm:node/2", venue_lat=38.9, venue_lon=-6.9, reviewed=DAY),
    ]
    result = review_venues([venue("osm:node/1"), venue("osm:node/2")], reviews)
    assert [(v.id, v.location) for v in result] == [("osm:node/2", LatLon(lat=38.9, lon=-6.9))]


def test_review_sets_and_clears_terraces() -> None:
    old = LatLon(lat=38.8801, lon=-6.9701)
    reviews = [
        Review(venue_id="osm:node/1", status="no_terrace", reviewed=DAY),
        Review(
            venue_id="osm:node/2",
            status="terrace",
            terrace_lat=38.881,
            terrace_lon=-6.971,
            reviewed=DAY,
        ),
        Review(venue_id="osm:node/3", status="terrace", reviewed=DAY),
    ]
    one, two, three, four = review_terraces(
        [
            record("osm:node/1", old),
            record("osm:node/2", old),
            record("osm:node/3", None),
            record("osm:node/4", old),
        ],
        reviews,
    )
    assert one.terrace is None
    assert two.terrace == LatLon(lat=38.881, lon=-6.971)
    assert two.sources == ["osm", "review"]
    assert three.terrace == three.venue  # no pin yet: the venue position
    assert four.terrace == old


def test_review_adds_venues_no_source_lists() -> None:
    added = Review(
        venue_id="review:bar-nuevo",
        status="terrace",
        name="Bar Nuevo",
        kind="bar",
        venue_lat=38.879,
        venue_lon=-6.971,
        reviewed=DAY,
    )
    (_osm, new) = review_venues([venue("osm:node/1")], [added])
    assert new.id == "review:bar-nuevo"
    assert (new.name, new.kind, new.location) == (
        "Bar Nuevo",
        "bar",
        LatLon(lat=38.879, lon=-6.971),
    )


def test_added_venue_goes_through_the_whole_build() -> None:
    added = Review(
        venue_id="review:bar-x",
        status="terrace",
        name="Bar X",
        kind="bar",
        venue_lat=38.879,
        venue_lon=-6.971,
        terrace_lat=38.8791,
        terrace_lon=-6.9711,
        reviewed=DAY,
    )
    reviews = [added]

    records = review_terraces(build_terraces(review_venues([], reviews), []), reviews)

    assert records == [
        Terrace(
            id="review:bar-x",
            name="Bar X",
            kind="bar",
            venue=LatLon(lat=38.879, lon=-6.971),
            terrace=LatLon(lat=38.8791, lon=-6.9711),
            sources=["review"],
            verified=None,
        )
    ]


def test_read_review_takes_looks_right_and_older_files(tmp_path: Path) -> None:
    new = tmp_path / "new.csv"
    new.write_text(
        HEADER.rstrip("\n") + ",looks_right\n" + "osm:node/1,terrace,,,,,,,2026-11-24,yes\n",
        encoding="utf-8",
    )
    assert read_review(new)[0].looks_right is True
    old = tmp_path / "old.csv"
    old.write_text(HEADER + "osm:node/1,terrace,,,,,,,2026-11-24\n", encoding="utf-8")
    assert read_review(old)[0].looks_right is False


def test_looks_right_is_only_for_a_terrace(tmp_path: Path) -> None:
    path = tmp_path / "review.csv"
    path.write_text(
        HEADER.rstrip("\n") + ",looks_right\n" + "osm:node/1,no_terrace,,,,,,,2026-11-24,yes\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="only for a terrace"):
        read_review(path)

import json
from datetime import date

from solycerveza.proposals import OvertureAttrs
from solycerveza.review import Review
from solycerveza.trust import evaluate, render, tier_of, venue_trust
from solycerveza.venues import LatLon, Venue


def attrs(confidence: float, *datasets: str) -> OvertureAttrs:
    return OvertureAttrs(confidence, "bar", tuple(sorted(datasets)), True)


def venue(venue_id: str) -> Venue:
    return Venue(
        id=venue_id,
        name="Bar",
        kind="bar",
        location=LatLon(lat=38.88, lon=-6.97),
        outdoor_seating=None,
    )


def test_strong_needs_confidence_and_meta_with_brightquery_or_the_junta() -> None:
    assert tier_of(attrs(0.95, "meta", "BrightQuery", "Overture"), junta=False) == "strong"
    assert tier_of(attrs(0.9, "meta", "Overture"), junta=True) == "strong"
    assert tier_of(attrs(0.89, "meta", "BrightQuery"), junta=True) == "weak"
    assert tier_of(attrs(0.99, "meta", "Overture"), junta=False) == "weak"
    assert tier_of(attrs(0.99, "BrightQuery", "BrightQuery"), junta=False) == "weak"


def test_only_overture_venues_get_a_row_with_the_position_hint() -> None:
    venues = [
        venue("overture:b"),
        venue("osm:node/1"),
        venue("overture:a"),
        venue("junta:0123456789ab"),
    ]
    rows = venue_trust(
        venues,
        {"overture:a"},
        {
            "overture:a": attrs(0.95, "BrightQuery", "BrightQuery", "Overture"),
            "overture:b": attrs(0.7, "meta", "Overture"),
        },
    )
    assert [(r.venue_id, r.tier, r.position_doubtful, r.junta) for r in rows] == [
        ("overture:a", "strong", True, True),
        ("overture:b", "weak", False, False),
    ]
    assert rows[0].datasets == ("BrightQuery",)


def test_render_is_deterministic_json() -> None:
    rows = venue_trust(
        [venue("overture:b"), venue("overture:a")],
        set(),
        {"overture:a": attrs(0.912, "meta"), "overture:b": attrs(0.5, "BrightQuery")},
    )
    text = render(rows)
    assert text == render(list(reversed(rows)))
    assert text.endswith("}\n")
    data = json.loads(text)
    assert [v["venue_id"] for v in data["venues"]] == ["overture:a", "overture:b"]
    assert data["venues"][0] == {
        "venue_id": "overture:a",
        "tier": "weak",
        "position_doubtful": False,
        "confidence": 0.91,
        "datasets": ["meta"],
        "junta": False,
    }


def test_evaluate_counts_not_venue_per_tier() -> None:
    venues = [venue(f"overture:{i}") for i in "abcd"] + [venue("junta:0123456789ab")]
    rows = venue_trust(
        venues,
        set(),
        {
            "overture:a": attrs(0.95, "meta", "BrightQuery"),
            "overture:b": attrs(0.95, "meta", "BrightQuery"),
            "overture:c": attrs(0.7, "meta"),
            "overture:d": attrs(0.7, "BrightQuery"),
        },
    )
    day = date(2026, 11, 26)
    reviews = [
        Review(venue_id="overture:a", status="not_venue", reviewed=day),
        Review(venue_id="overture:b", status="terrace", reviewed=day),
        Review(venue_id="overture:c", status="not_venue", reviewed=day),
        Review(venue_id="overture:d", status="not_venue", reviewed=day),
    ]
    report = evaluate(rows, venues, reviews)
    assert "| strong | 2 | 1 | 50% | 0 |" in report
    assert "| weak | 2 | 2 | 100% | 0 |" in report
    assert "| position doubtful (any tier) | 1 | 1 | 100% | 0 |" in report
    assert "| Junta only (untiered) | 0 | 0 | 0% | 1 |" in report
    assert "2.00x" in report

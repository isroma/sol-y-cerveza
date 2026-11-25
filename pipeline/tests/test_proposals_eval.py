from datetime import date

import pytest

from solycerveza.proposals import Proposal
from solycerveza.proposals_eval import (
    answer_key,
    evaluate,
    evaluation_targets,
    percentile,
    threshold_for,
)
from solycerveza.review import Review
from solycerveza.terraces import Terrace
from solycerveza.venues import LatLon

DAY = date(2026, 11, 23)
HERE = LatLon(lat=38.878, lon=-6.97)


def north(metres: float) -> LatLon:
    return LatLon(lat=HERE.lat + metres / 111_195, lon=HERE.lon)


def rec(venue_id: str, sources: list[str], terrace: LatLon | None = None) -> Terrace:
    return Terrace(
        id=venue_id,
        name="Bar",
        kind="bar",
        venue=HERE,
        terrace=terrace,
        sources=sources,
        verified=None,
    )


def review(venue_id: str, status: str | None, **extra: float) -> Review:
    return Review.model_validate({"venue_id": venue_id, "status": status, "reviewed": DAY, **extra})


def proposal(
    venue_id: str,
    kind: str,
    confidence: float,
    at: LatLon | None = None,
    source: str | None = None,
) -> Proposal:
    source = (
        source
        or {
            "terrace": "pnoa-ortho+claude",
            "no_terrace": "pnoa-ortho+claude",
            "position": "junta+cartociudad",
            "not_venue": "overture-attributes",
        }[kind]
    )
    return Proposal.model_validate(
        {
            "venue_id": venue_id,
            "kind": kind,
            "lat": None if at is None else at.lat,
            "lon": None if at is None else at.lon,
            "confidence": confidence,
            "evidence": "e",
            "source": source,
            "generated": DAY,
        }
    )


BASELINE = [
    rec("osm:node/1", ["osm"]),
    rec("osm:node/2", ["osm"]),
    rec("osm:node/3", ["osm"]),
    rec("overture:a", ["overture"]),
    rec("overture:b", ["overture"]),
    rec("junta:0123456789ab", ["junta"]),
]
REVIEWS = [
    review("osm:node/1", "terrace", terrace_lat=north(10).lat, terrace_lon=north(10).lon),
    review("osm:node/2", "no_terrace"),
    review("osm:node/3", "terrace"),
    review("overture:a", "not_venue"),
    review("overture:b", "no_terrace", venue_lat=north(30).lat, venue_lon=north(30).lon),
    review("junta:0123456789ab", "terrace"),
    review("osm:node/99", "no_terrace"),  # not in the baseline
]


def test_answer_key_uses_the_owner_positions() -> None:
    truth = answer_key(BASELINE, REVIEWS)
    assert truth["osm:node/1"].terrace == north(10)
    assert truth["osm:node/3"].terrace == HERE  # no pin: the venue position they accepted
    assert truth["overture:b"].moved and truth["overture:b"].venue == north(30)
    assert truth["osm:node/2"].terrace is None
    assert "osm:node/99" not in truth


def test_evaluation_targets() -> None:
    targets = evaluation_targets(BASELINE, REVIEWS)
    assert [t.id for t in targets.vision] == [
        "osm:node/1",
        "osm:node/2",
        "osm:node/3",
        "overture:b",
        "junta:0123456789ab",
    ]
    assert [t.id for t in targets.overture] == ["overture:a", "overture:b"]
    assert len(targets.position) == 6


def test_percentile_is_nearest_rank() -> None:
    assert percentile([5, 1, 3], 50) == 3
    assert percentile(list(range(1, 11)), 90) == 9
    assert percentile([7], 90) == 7


def test_threshold_is_the_lowest_confidence_reaching_the_target() -> None:
    scored = [(0.9, True), (0.8, True), (0.7, False), (0.6, True), (0.5, False)]
    t = threshold_for(scored, 0.9)
    assert t is not None and (t.confidence, t.kept, t.right) == (0.8, 2, 2)
    assert threshold_for([(0.9, False)], 0.9) is None


def test_evaluate_report() -> None:
    proposals = [
        proposal("osm:node/1", "terrace", 0.9, north(13)),  # right, 3 m from the pin
        proposal("osm:node/2", "terrace", 0.6, HERE),  # wrong
        proposal("osm:node/3", "no_terrace", 0.7),  # wrong
        proposal("overture:a", "not_venue", 0.8),  # right
        proposal("overture:b", "not_venue", 0.4),  # wrong
        proposal("overture:b", "position", 0.9, north(25)),  # right, 5 m from the owner's
    ]
    ran = {
        "vision": ["osm:node/1", "osm:node/2", "osm:node/3", "junta:0123456789ab"],
        "position": [t.id for t in BASELINE],
        "junta+cartociudad": [t.id for t in BASELINE],
        "overture": ["overture:a", "overture:b"],
    }
    report = evaluate(proposals, ran, BASELINE, REVIEWS)
    assert report == evaluate(proposals, ran, BASELINE, REVIEWS)
    assert "### The venue's OSM address (osm-addr+cartociudad)\n\nNot run." in report
    assert (
        "Answer key: 6 reviewed venues (3 terrace, 2 no terrace, 1 not a venue, 1 moved)." in report
    )
    assert "Not in the baseline, left out: 1 (osm:node/99)." in report
    assert "4 venues answered (1 unsure, no proposal)" in report
    assert "- **terrace**: 2 proposals; precision 50% (1/2), recall 33% (1/3)." in report
    assert "At confidence >= 0.90: precision 100% (1/1), recall 33% (1/3)." in report
    assert "- **no_terrace**: 1 proposals; precision 0% (0/1), recall 0% (0/1)." in report
    assert "median 3 m, p90 3 m from the owner's; the pre-review position was median 10 m" in report
    assert "- **position**: 1 proposals; precision 100% (1/1), recall 100% (1/1) of moved" in report
    assert (
        "- **not_venue (any score)**: 2 proposals; precision 50% (1/2), recall 100% (1/1)."
        in report
    )
    assert "At confidence >= 0.80: precision 100% (1/1), recall 100% (1/1)." in report


def test_evaluate_scores_each_address_source_apart() -> None:
    proposals = [
        proposal("overture:b", "position", 0.6, north(80), "junta+cartociudad"),  # wrong
        proposal("overture:b", "position", 0.7, north(28), "overture-addr+cartociudad"),  # right
        proposal("osm:node/1", "position", 0.8, north(40), "osm-addr+cartociudad"),  # wrong
    ]
    ran = {
        "position": [t.id for t in BASELINE],
        "junta+cartociudad": [t.id for t in BASELINE],
        "osm-addr+cartociudad": ["osm:node/1", "osm:node/2"],
        "overture-addr+cartociudad": ["overture:b"],
    }
    report = evaluate(proposals, ran, BASELINE, REVIEWS)
    osm = report.split("(osm-addr+cartociudad)")[1].split("###")[0]
    assert "- 2 venues with an address, 0 of them moved by the owner." in osm
    assert "precision 0% (0/1), recall n/a of moved venues." in osm
    assert "No confidence threshold gives 90% precision." in osm
    assert "median 40 m, p90 40 m; the pre-review position was median 0 m" in osm
    overture = report.split("(overture-addr+cartociudad)")[1].split("###")[0]
    assert "- 1 venues with an address, 1 of them moved by the owner." in overture
    assert "precision 100% (1/1), recall 100% (1/1) of moved venues." in overture
    assert "At confidence >= 0.70: precision 100% (1/1)." in overture
    assert "median 2 m, p90 2 m; the pre-review position was median 30 m" in overture
    combined = report.split("as `venue_proposals.csv` keeps them")[1]
    # The most confident per venue: OSM for osm:node/1 (wrong), Overture for overture:b (right).
    assert "- **position**: 2 proposals; precision 50% (1/2), recall 100% (1/1)" in combined


@pytest.mark.parametrize("missing", ["vision", "position", "overture"])
def test_evaluate_marks_proposers_that_did_not_run(missing: str) -> None:
    ran: dict[str, list[str]] = {
        name: [] for name in ("vision", "position", "overture") if name != missing
    }
    assert "Not run." in evaluate([], ran, BASELINE, REVIEWS)

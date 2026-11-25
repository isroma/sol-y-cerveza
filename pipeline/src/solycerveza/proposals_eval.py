"""Score the proposers against the owner's review decisions (ADR-0008).

The answer key is `venue_review.csv`. The proposers see each reviewed venue as it was before
the review (a baseline `terraces.json`, or the build's records without the review applied), and
their proposals are compared with what the owner decided:

- terrace / no_terrace: precision and recall on venues the owner marked `terrace` or
  `no_terrace` (`not_venue` ones have no terrace answer and are left out).
- not_venue: precision and recall on the Overture-only venues the owner reviewed.
- terrace pins: distance from the owner's terrace position (their pin, else the terrace or
  venue position they accepted), next to the distance of the pre-review position ("do nothing").
- position: a proposal is right when it is within `POSITION_OK_M` of the owner's venue position
  (the moved one, or the original when they kept it); recall counts the venues they moved. Each
  address source (Junta register, OSM `addr:*`, Overture `addresses`) is scored on its own, over
  the venues it has an address for, and then all together as the CSV keeps them.
- For each, the lowest confidence threshold at which precision reaches `TARGET_PRECISION`.

The report is Markdown, with no dates or timings, so the same inputs give the same bytes.
"""

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from solycerveza.geo import distance_m
from solycerveza.proposals import (
    ADDRESS_SOURCES,
    JUNTA_SOURCE,
    SOURCES,
    Proposal,
    Targets,
    overture_only,
    sort_key,
)
from solycerveza.review import Review
from solycerveza.terraces import Terrace
from solycerveza.venues import LatLon

POSITION_OK_M = 15.0
TARGET_PRECISION = 0.9
POSITION_TITLES = {
    JUNTA_SOURCE: "Junta register address",
    ADDRESS_SOURCES["osm"]: "The venue's OSM address",
    ADDRESS_SOURCES["overture"]: "The venue's Overture address",
}


@dataclass(frozen=True)
class Truth:
    status: str | None  # terrace, no_terrace, not_venue, or None (position only)
    venue: LatLon  # the owner's venue position
    terrace: LatLon | None  # the owner's terrace position, for `terrace`
    moved: bool


def answer_key(baseline: Sequence[Terrace], reviews: Sequence[Review]) -> dict[str, Truth]:
    """The owner's decision for each reviewed venue present in the baseline."""
    by_id = {t.id: t for t in baseline}
    truth: dict[str, Truth] = {}
    for r in reviews:
        t = by_id.get(r.venue_id)
        if t is None:
            continue
        venue = r.venue or t.venue
        terrace = (r.terrace or t.terrace or venue) if r.status == "terrace" else None
        truth[r.venue_id] = Truth(
            status=r.status, venue=venue, terrace=terrace, moved=r.venue is not None
        )
    return truth


def evaluation_targets(baseline: Sequence[Terrace], reviews: Sequence[Review]) -> Targets:
    """The reviewed venues, as before the review; vision only where a terrace answer exists."""
    status = {r.venue_id: r.status for r in reviews}
    reviewed = [t for t in baseline if t.id in status]
    return Targets(
        vision=[t for t in reviewed if status[t.id] in ("terrace", "no_terrace")],
        position=reviewed,
        overture=[t for t in reviewed if overture_only(t)],
    )


def percentile(values: Sequence[float], q: float) -> float:
    """Nearest-rank percentile (q in 0-100) of a non-empty list."""
    ordered = sorted(values)
    rank = max(1, math.ceil(q / 100 * len(ordered)))
    return ordered[rank - 1]


def _ratio(n: int, d: int) -> str:
    return "n/a" if d == 0 else f"{n / d:.0%} ({n}/{d})"


def _distances(values: Sequence[float]) -> str:
    if not values:
        return "n/a"
    return f"median {percentile(values, 50):.0f} m, p90 {percentile(values, 90):.0f} m"


@dataclass(frozen=True)
class Threshold:
    confidence: float
    precision: float
    kept: int
    right: int


def threshold_for(
    scored: Sequence[tuple[float, bool]], target: float = TARGET_PRECISION
) -> Threshold | None:
    """The lowest confidence at which proposals at or above it are right `target` of the time."""
    best: Threshold | None = None
    for c in sorted({c for c, _ in scored}, reverse=True):
        kept = [ok for conf, ok in scored if conf >= c]
        precision = sum(kept) / len(kept)
        if precision >= target:
            best = Threshold(confidence=c, precision=precision, kept=len(kept), right=sum(kept))
    return best


def _classification(
    title: str,
    proposals: Sequence[Proposal],
    evaluated: Sequence[str],
    is_right: Callable[[str], bool],
) -> list[str]:
    """Lines for one proposal kind: precision, recall and the 90 % threshold."""
    ids = set(evaluated)
    mine = [p for p in proposals if p.venue_id in ids]
    scored = [(p.confidence, is_right(p.venue_id)) for p in mine]
    right = sum(ok for _, ok in scored)
    positives = sum(is_right(v) for v in ids)
    lines = [
        f"- **{title}**: {len(mine)} proposals; precision {_ratio(right, len(mine))}, "
        f"recall {_ratio(right, positives)}."
    ]
    threshold = threshold_for(scored)
    if threshold is None:
        lines.append(f"  - No confidence threshold gives {TARGET_PRECISION:.0%} precision.")
    else:
        lines.append(
            f"  - At confidence >= {threshold.confidence:.2f}: precision {threshold.precision:.0%}"
            f" ({threshold.right}/{threshold.kept}), recall {_ratio(threshold.right, positives)}."
        )
    return lines


def _position_lines(
    mine: Sequence[Proposal],
    looked_at: Sequence[str],
    truth: dict[str, Truth],
    by_id: dict[str, Terrace],
    looked_at_as: str = "with an address",
) -> list[str]:
    """Lines for one set of `position` proposals over the venues it could propose for."""
    moved = sum(truth[v].moved for v in looked_at)
    far = [distance_m(p.location, truth[p.venue_id].venue) for p in mine if p.location is not None]
    before = [distance_m(by_id[p.venue_id].venue, truth[p.venue_id].venue) for p in mine]
    scored = [(p.confidence, d <= POSITION_OK_M) for p, d in zip(mine, far, strict=True)]
    right = sum(ok for _, ok in scored)
    right_moved = sum(
        ok and truth[p.venue_id].moved for p, (_, ok) in zip(mine, scored, strict=True)
    )
    lines = [
        f"- {len(looked_at)} venues {looked_at_as}, {moved} of them moved by the owner.",
        f"- **position**: {len(mine)} proposals; precision {_ratio(right, len(mine))}, "
        f"recall {_ratio(right_moved, moved)} of moved venues.",
    ]
    threshold = threshold_for(scored)
    if threshold is None:
        lines.append(f"  - No confidence threshold gives {TARGET_PRECISION:.0%} precision.")
    else:
        lines.append(
            f"  - At confidence >= {threshold.confidence:.2f}: precision "
            f"{threshold.precision:.0%} ({threshold.right}/{threshold.kept})."
        )
    lines.append(
        f"- **Distance from the owner's position**: {_distances(far)}; the pre-review position "
        f"was {_distances(before)}."
    )
    return lines


def evaluate(
    proposals: Sequence[Proposal],
    ran: dict[str, list[str]],
    baseline: Sequence[Terrace],
    reviews: Sequence[Review],
) -> str:
    """The Markdown report."""
    truth = answer_key(baseline, reviews)
    by_id = {t.id: t for t in baseline}
    missing = sorted({r.venue_id for r in reviews} - set(truth))
    counts = {s: sum(t.status == s for t in truth.values()) for s in ("terrace", "no_terrace")}
    lines = [
        "# Venue proposals: trial against the owner's review",
        "",
        f"Answer key: {len(truth)} reviewed venues ({counts['terrace']} terrace, "
        f"{counts['no_terrace']} no terrace, "
        f"{sum(t.status == 'not_venue' for t in truth.values())} not a venue, "
        f"{sum(t.moved for t in truth.values())} moved).",
    ]
    if missing:
        lines.append(f"Not in the baseline, left out: {len(missing)} ({', '.join(missing)}).")
    lines.append("")

    vision = [p for p in proposals if p.source == "pnoa-ortho+claude"]
    lines.append("## Terrace from the orthophoto (pnoa-ortho+claude)")
    lines.append("")
    if "vision" not in ran:
        lines.append("Not run.")
    else:
        answered = ran["vision"]
        unsure = len(answered) - sum(p.venue_id in set(answered) for p in vision)
        lines.append(
            f"{len(answered)} venues answered ({unsure} unsure, no proposal), out of "
            f"{counts['terrace'] + counts['no_terrace']} with a terrace decision."
        )
        lines.append("")
        lines += _classification(
            "terrace",
            [p for p in vision if p.kind == "terrace"],
            answered,
            lambda v: truth[v].status == "terrace",
        )
        lines += _classification(
            "no_terrace",
            [p for p in vision if p.kind == "no_terrace"],
            answered,
            lambda v: truth[v].status == "no_terrace",
        )
        pins: list[float] = []
        before: list[float] = []
        for p in vision:
            owner = truth[p.venue_id].terrace
            if p.kind != "terrace" or p.location is None or owner is None:
                continue
            pins.append(distance_m(p.location, owner))
            record = by_id[p.venue_id]
            before.append(distance_m(record.terrace or record.venue, owner))
        lines.append(
            f"- **Terrace pins** (right proposals, n={len(pins)}): {_distances(pins)} from the "
            f"owner's; the pre-review position was {_distances(before)}."
        )
    lines.append("")

    lines.append("## Position from a street address (CartoCiudad)")
    lines.append("")
    if "position" not in ran:
        lines.append("Not run.")
    else:
        evaluated = ran["position"]
        moved = sum(truth[v].moved for v in evaluated)
        lines.append(
            f"{len(evaluated)} venues looked at, {moved} of them moved by the owner; "
            f"a proposal is right within {POSITION_OK_M:.0f} m of the owner's position."
        )
        positions = [p for p in proposals if p.kind == "position" and p.venue_id in set(evaluated)]
        for source in SOURCES["position"]:
            lines.append("")
            lines.append(f"### {POSITION_TITLES[source]} ({source})")
            lines.append("")
            if source not in ran:
                lines.append("Not run.")
                continue
            with_address = ran[source]
            mine = [p for p in positions if p.source == source]
            lines += _position_lines(mine, with_address, truth, by_id)
            if source == JUNTA_SOURCE:
                junta = [v for v in evaluated if v.startswith("junta:")]
                lines.append(
                    f"- Junta venues looked at: {len(junta)}, proposals for them: "
                    f"{sum(p.venue_id.startswith('junta:') for p in mine)} (they already sit at "
                    "their own CartoCiudad portal)."
                )
        lines.append("")
        lines.append("### All sources, as `venue_proposals.csv` keeps them (the most confident)")
        lines.append("")
        best: dict[str, Proposal] = {}
        for p in sorted(positions, key=sort_key):
            best.setdefault(p.venue_id, p)
        lines += _position_lines(list(best.values()), evaluated, truth, by_id, "looked at")
    lines.append("")

    lines.append("## Not a venue, from Overture attributes (overture-attributes)")
    lines.append("")
    if "overture" not in ran:
        lines.append("Not run.")
    else:
        evaluated = ran["overture"]
        nv = sum(truth[v].status == "not_venue" for v in evaluated)
        lines.append(f"{len(evaluated)} Overture-only venues reviewed, {nv} not a venue.")
        lines.append("")
        lines += _classification(
            "not_venue (any score)",
            [p for p in proposals if p.kind == "not_venue"],
            evaluated,
            lambda v: truth[v].status == "not_venue",
        )
    lines.append("")
    lines.append(
        "Small samples: a threshold reached on a handful of proposals is a hint, not a "
        "guarantee. Re-run after the next review batch."
    )
    return "\n".join(lines) + "\n"

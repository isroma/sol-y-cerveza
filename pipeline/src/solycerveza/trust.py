"""A trust tier for each Overture-only venue, for the admin's review queue (issue #493).

Dev only: `python -m solycerveza.trust` writes `pipeline/.cache/venue_trust.json`, which the
admin's dev server reads (`GET /__admin/trust`) to show a badge and to order the review queue
weak-first. The build never reads it, and nothing of it reaches `terraces.json` or visitors.

- **strong**: Overture `confidence` >= `STRONG_CONFIDENCE`, and either its `datasets` include
  both `meta` and `BrightQuery` or a Junta register row confirms the venue
  (`junta.add_register_venues`, the build's own matcher).
- **weak**: every other Overture-only venue.
- `position_doubtful`: the record's only position source is BrightQuery (`BrightQuery` and not
  `meta`); on release 2026-11-18.0 those points sat a median 296 m from the OSM position of the
  same venue, against 14 m for Meta.

OSM, curated, `review:` and Junta venues get no row (untiered). The tier is computed on the venue
list before `venue_review.csv` is applied, as the build sees it. `--evaluate` prints the
`not_venue` rate of the owner's reviewed venues per tier, to check the rule after each batch of
reviews.
"""

import argparse
import json
import logging
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from solycerveza.overture import BRIGHTQUERY, META, cache_path
from solycerveza.proposals import OvertureAttrs, read_overture_attrs
from solycerveza.review import Review, read_review
from solycerveza.sources import load_venues_and_confirmed
from solycerveza.venues import CACHE_DIR, Venue

logger = logging.getLogger(__name__)

TRUST_JSON = CACHE_DIR / "venue_trust.json"
STRONG_CONFIDENCE = 0.9

Tier = Literal["strong", "weak"]


@dataclass(frozen=True)
class VenueTrust:
    venue_id: str
    tier: Tier
    position_doubtful: bool
    confidence: float
    datasets: tuple[str, ...]
    junta: bool


def tier_of(attrs: OvertureAttrs, junta: bool) -> Tier:
    both = META in attrs.datasets and BRIGHTQUERY in attrs.datasets
    return "strong" if (both or junta) and attrs.confidence >= STRONG_CONFIDENCE else "weak"


def venue_trust(
    venues: Sequence[Venue], confirmed: Collection[str], attrs: Mapping[str, OvertureAttrs]
) -> list[VenueTrust]:
    """One row per Overture venue in `venues`, sorted by id."""
    rows: list[VenueTrust] = []
    for venue in sorted(venues, key=lambda v: v.id):
        a = attrs.get(venue.id)
        if not venue.id.startswith("overture:") or a is None:
            continue
        rows.append(
            VenueTrust(
                venue_id=venue.id,
                tier=tier_of(a, venue.id in confirmed),
                position_doubtful=BRIGHTQUERY in a.datasets and META not in a.datasets,
                confidence=round(a.confidence, 2),
                # The parquet repeats a dataset per source record, and lists "Overture" itself.
                datasets=tuple(sorted(set(a.datasets) - {"Overture"})),
                junta=venue.id in confirmed,
            )
        )
    return rows


def render(rows: Sequence[VenueTrust]) -> str:
    """Deterministic JSON: rows sorted by id, 2-space indent, trailing newline."""
    venues = [
        {
            "venue_id": r.venue_id,
            "tier": r.tier,
            "position_doubtful": r.position_doubtful,
            "confidence": r.confidence,
            "datasets": list(r.datasets),
            "junta": r.junta,
        }
        for r in sorted(rows, key=lambda r: r.venue_id)
    ]
    return json.dumps({"venues": venues}, ensure_ascii=False, indent=2) + "\n"


def evaluate(rows: Sequence[VenueTrust], venues: Sequence[Venue], reviews: Sequence[Review]) -> str:
    """A Markdown table: reviewed venues per tier (rows with a status), and how many were
    `not_venue`, plus the unreviewed count. Junta-only venues get a line of their own."""
    status = {r.venue_id: r.status for r in reviews}

    def counts(ids: Sequence[str]) -> tuple[int, int, int]:
        decided = [status[i] for i in ids if status.get(i)]
        return (len(decided), decided.count("not_venue"), sum(i not in status for i in ids))

    groups = {
        "strong": [r.venue_id for r in rows if r.tier == "strong"],
        "weak": [r.venue_id for r in rows if r.tier == "weak"],
        "position doubtful (any tier)": [r.venue_id for r in rows if r.position_doubtful],
        "Junta only (untiered)": [v.id for v in venues if v.id.startswith("junta:")],
    }
    lines = [
        "| Group | Reviewed | `not_venue` | Rate | Unreviewed |",
        "| ----- | -------- | ----------- | ---- | ---------- |",
    ]
    rates: dict[str, float] = {}
    for name, ids in groups.items():
        reviewed, not_venue, unreviewed = counts(ids)
        rate = not_venue / reviewed if reviewed else 0.0
        rates[name] = rate
        lines.append(f"| {name} | {reviewed} | {not_venue} | {rate:.0%} | {unreviewed} |")
    if rates["strong"] > 0:
        lines.append("")
        lines.append(f"Weak / strong `not_venue` rate: {rates['weak'] / rates['strong']:.2f}x.")
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Write the admin's venue trust tiers.")
    parser.add_argument(
        "--evaluate", action="store_true", help="also print not_venue rates per tier"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    venues, confirmed = load_venues_and_confirmed()
    rows = venue_trust(venues, confirmed, read_overture_attrs(cache_path(CACHE_DIR)))
    TRUST_JSON.parent.mkdir(parents=True, exist_ok=True)
    partial = TRUST_JSON.with_suffix(".part")
    partial.write_text(render(rows), encoding="utf-8")
    partial.replace(TRUST_JSON)
    logger.info(
        "%d Overture venues: %d strong, %d weak (%d position doubtful) -> %s",
        len(rows),
        sum(r.tier == "strong" for r in rows),
        sum(r.tier == "weak" for r in rows),
        sum(r.position_doubtful for r in rows),
        TRUST_JSON,
    )
    if args.evaluate:
        print(evaluate(rows, venues, read_review()), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

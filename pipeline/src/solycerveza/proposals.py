"""Machine proposals for venues the owner has not reviewed yet (ADR-0008).

`python -m solycerveza.proposals` writes `pipeline/data/venue_proposals.csv`. Like
`price_candidates.csv` (ADR-0006), these are proposals, not data: the build never reads the file.
The owner confirms or rejects each one in the admin, which records the decision in
`venue_review.csv` as usual.

Three proposers, each optional (`--only`) and each cached in `.cache/`:

- `vision`: a terrace read from the PNOA orthophoto by the Claude API (`solycerveza.ortho`,
  `solycerveza.terrace_vision`). Proposes `terrace` (with the tables' position) or
  `no_terrace`. Costs money: it prints an estimate and asks nothing new without `--yes` or
  `--limit N`.
- `position`: the Junta register address geocoded by CartoCiudad (`solycerveza.junta`), for every
  venue a register row matches. Proposes `position` when the portal is more than
  `MIN_MOVE_M` from the venue's current position.
- `overture`: `not_venue` for Overture-only places, scored from Overture's own attributes
  (confidence, sources, website, generic name). No network.

`--evaluate` runs the proposers on the venues the owner reviewed, as they were before the review,
and scores them against the owner's decisions (`solycerveza.proposals_eval`).

`venue_proposals.csv` (UTF-8, header required, sorted by `venue_id` then `kind`), one row per
proposal:

- `venue_id`: as in `venue_review.csv`.
- `kind`: `terrace` (lat/lon: where the tables are), `no_terrace`, `position` (lat/lon: the
  corrected venue position) or `not_venue`.
- `lat`, `lon`: WGS84, 6 decimals; empty for `no_terrace` and `not_venue`.
- `confidence`: 0.00 to 1.00, two decimals.
- `evidence`: one short English sentence.
- `source`: what produced it: `pnoa-ortho+claude`, `junta+cartociudad` or `overture-attributes`.
- `generated`: YYYY-MM-DD the evidence was produced (a re-run keeps the date of an unchanged row).
"""

import argparse
import csv
import json
import logging
import re
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Self

import duckdb
import httpx
from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, model_validator

from solycerveza.junta import RegisterRow, load_register, register_id
from solycerveza.ortho import ORTHO_CACHE, Crop, OrthoFetcher, cached_crop
from solycerveza.overture import (
    PRIMARY_KINDS,
    cache_path,
    distance_m,
    name_similarity,
    normalize_name,
    same_venue,
)
from solycerveza.review import read_review
from solycerveza.sources import load_all_venues
from solycerveza.terrace_vision import (
    VISION_CACHE,
    Asker,
    CachedAnswer,
    ClaudeAsker,
    answer_key,
    ask,
    estimate_usd,
    read_answer,
    write_answer,
)
from solycerveza.terraces import Terrace, build_terraces, read_curated
from solycerveza.venues import CACHE_DIR, VENUE_ID_PATTERN, Lat, LatLon, Lon, Venue, load_seating

logger = logging.getLogger(__name__)

PROPOSALS_CSV = Path(__file__).resolve().parents[2] / "data" / "venue_proposals.csv"
TERRACES_JSON = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terraces.json"
EVAL_REPORT = CACHE_DIR / "proposals_eval.md"
EVAL_CSV = CACHE_DIR / "proposals_eval.csv"
COLUMNS = ("venue_id", "kind", "lat", "lon", "confidence", "evidence", "source", "generated")
PROPOSERS = ("vision", "position", "overture")
SOURCES = {
    "vision": "pnoa-ortho+claude",
    "position": "junta+cartociudad",
    "overture": "overture-attributes",
}
MIN_MOVE_M = 25.0
DEFAULT_MIN_CONFIDENCE = 0.5

ProposalKind = Literal["terrace", "no_terrace", "position", "not_venue"]
KINDS_WITH_POSITION = frozenset({"terrace", "position"})


def _round2(value: float) -> float:
    return round(value, 2)


class Proposal(BaseModel):
    """One row of `venue_proposals.csv`."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    kind: ProposalKind
    lat: Lat | None = None
    lon: Lon | None = None
    confidence: Annotated[float, Field(ge=0, le=1), AfterValidator(_round2)]
    evidence: Annotated[str, Field(min_length=1, max_length=300, pattern=r"^[^\n\r]+$")]
    source: Annotated[str, Field(pattern=r"^[a-z0-9]+([+-][a-z0-9]+)*$")]
    generated: date

    @model_validator(mode="after")
    def _position(self) -> Self:
        has_position = self.lat is not None and self.lon is not None
        if (self.lat is None) != (self.lon is None):
            raise ValueError("lat and lon go together")
        if (self.kind in KINDS_WITH_POSITION) != has_position:
            raise ValueError(f"{self.kind}: lat/lon are required for terrace and position only")
        return self

    @property
    def location(self) -> LatLon | None:
        if self.lat is None or self.lon is None:
            return None
        return LatLon(lat=self.lat, lon=self.lon)

    @property
    def key(self) -> tuple[str, str]:
        return (self.venue_id, self.kind)


def sort_key(p: Proposal) -> tuple[str, str, float, str]:
    return (p.venue_id, p.kind, -p.confidence, p.source)


def read_proposals(path: Path = PROPOSALS_CSV) -> list[Proposal]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(COLUMNS)}")
        rows: list[Proposal] = []
        for row in reader:
            if None in row:
                raise ValueError(f"{path}:{reader.line_num}: more cells than columns")
            cells = {k: (v or "").strip() or None for k, v in row.items()}
            try:
                rows.append(Proposal.model_validate(cells))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    return rows


def write_proposals(rows: Iterable[Proposal], path: Path = PROPOSALS_CSV) -> None:
    """Write one row per venue and kind (the most confident), sorted, with "\\n" line ends."""
    unique: dict[tuple[str, str], Proposal] = {}
    for p in sorted(rows, key=sort_key):
        unique.setdefault(p.key, p)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(COLUMNS)
        for p in unique.values():
            writer.writerow(
                [
                    p.venue_id,
                    p.kind,
                    "" if p.lat is None else f"{p.lat:.6f}",
                    "" if p.lon is None else f"{p.lon:.6f}",
                    f"{p.confidence:.2f}",
                    p.evidence,
                    p.source,
                    p.generated.isoformat(),
                ]
            )


def keep_dates(old: Sequence[Proposal], new: Sequence[Proposal]) -> list[Proposal]:
    """New proposals keep the `generated` date of an identical old one (all but the date)."""

    def same(p: Proposal) -> tuple[object, ...]:
        return (p.venue_id, p.kind, p.lat, p.lon, p.confidence, p.evidence, p.source)

    dates = {same(p): p.generated for p in old}
    return [p.model_copy(update={"generated": dates.get(same(p), p.generated)}) for p in new]


# --- Venue state --------------------------------------------------------------------------


def read_records(path: Path) -> list[Terrace]:
    """The venue records of a `terraces.json` (any version that has `terraces`)."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    records = raw["terraces"] if isinstance(raw, dict) else raw
    return sorted((Terrace.model_validate(r) for r in records), key=lambda t: t.id)


def pre_review_records() -> list[Terrace]:
    """Every venue as the build sees it before `venue_review.csv` is applied (needs the caches)."""
    return build_terraces(load_all_venues(), read_curated(), load_seating())


def overture_only(t: Terrace) -> bool:
    return t.sources == ["overture"]


# --- Proposer: not a venue, from Overture attributes ----------------------------------------


@dataclass(frozen=True)
class OvertureAttrs:
    confidence: float
    category: str | None
    datasets: tuple[str, ...]
    has_website: bool | None  # None when the parquet predates the websites column


def read_overture_attrs(path: Path) -> dict[str, OvertureAttrs]:
    """Venue id -> the Overture attributes `fetch_places` keeps."""
    con = duckdb.connect()
    columns = {
        row[0]
        for row in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(path)]).fetchall()
    }
    websites = "len(websites) > 0" if "websites" in columns else "NULL"
    rows = con.execute(
        f"SELECT id, confidence, category, datasets, {websites} FROM read_parquet(?) ORDER BY id",
        [str(path)],
    ).fetchall()
    return {
        f"overture:{place_id}": OvertureAttrs(
            confidence=float(confidence or 0),
            category=category,
            datasets=tuple(sorted(str(d) for d in datasets or [])),
            has_website=None if has_website is None else bool(has_website),
        )
        for place_id, confidence, category, datasets, has_website in rows
    }


def not_venue_score(name: str, attrs: OvertureAttrs) -> tuple[float, list[str]]:
    """A transparent 0-1 score that an Overture place is not a bar or restaurant, and why.

    Hand-set weights, not fitted: `--evaluate` measures them on the owner's decisions.
    """
    score = 0.15
    reasons = [f"Overture confidence {attrs.confidence:.2f}"]
    if attrs.confidence < 0.7:
        score += 0.3
    elif attrs.confidence < 0.8:
        score += 0.15
    if len(attrs.datasets) <= 1:
        score += 0.15
        reasons.append(f"one source ({attrs.datasets[0] if attrs.datasets else 'none'})")
    if attrs.has_website is False:
        score += 0.15
        reasons.append("no website")
    if not normalize_name(name):
        score += 0.15
        reasons.append("a generic name")
    if attrs.category not in PRIMARY_KINDS and not (attrs.category or "").endswith("restaurant"):
        score += 0.1
        reasons.append(f"category {attrs.category}")
    return (min(score, 0.95), reasons)


def overture_proposals(
    records: Iterable[Terrace], attrs: dict[str, OvertureAttrs], today: date
) -> list[Proposal]:
    """A `not_venue` proposal, with its score, for every Overture-only record."""
    proposals: list[Proposal] = []
    for t in records:
        a = attrs.get(t.id)
        if not overture_only(t) or a is None:
            continue
        score, reasons = not_venue_score(t.name, a)
        proposals.append(
            Proposal(
                venue_id=t.id,
                kind="not_venue",
                confidence=score,
                evidence="; ".join(reasons) + ".",
                source=SOURCES["overture"],
                generated=today,
            )
        )
    return proposals


# --- Proposer: position from the register address -------------------------------------------


def _as_venue(t: Terrace) -> Venue:
    return Venue(id=t.id, name=t.name, kind=t.kind, location=t.venue, outdoor_seating=None)


def position_proposals(
    records: Sequence[Terrace],
    located: Iterable[tuple[RegisterRow, LatLon]],
    today: date,
    min_move_m: float = MIN_MOVE_M,
) -> list[Proposal]:
    """`position` where a matching register row's portal is over `min_move_m` away.

    A record is matched by its own register row (Junta venues) or by `same_venue`, keeping the
    most alike name. A Junta venue already sits at its own portal, so it gets a proposal only if
    another row matches it better.
    """
    venues = [_as_venue(t) for t in records]
    best: dict[str, tuple[float, RegisterRow, LatLon]] = {}
    for row, portal in located:
        rid = register_id(row)
        candidate = Venue(
            id=rid, name=row.name, kind=row.kind, location=portal, outdoor_seating=None
        )
        for v in venues:
            if v.id == rid:
                similarity = 100.0
            elif same_venue(candidate, v) and v.name is not None:
                similarity = name_similarity(row.name, v.name)
            else:
                continue
            current = best.get(v.id)
            if current is None or (similarity, rid) > (current[0], register_id(current[1])):
                best[v.id] = (similarity, row, portal)
    by_id = {t.id: t for t in records}
    proposals: list[Proposal] = []
    for venue_id in sorted(best):
        similarity, row, portal = best[venue_id]
        d = distance_m(by_id[venue_id].venue, portal)
        if d <= min_move_m:
            continue
        proposals.append(
            Proposal(
                venue_id=venue_id,
                kind="position",
                lat=portal.lat,
                lon=portal.lon,
                confidence=min(0.95, similarity / 100),
                evidence=(
                    f"The Junta register lists {row.name} at {row.street} {row.number}; "
                    f"CartoCiudad puts that portal {d:.0f} m from the current position."
                ),
                source=SOURCES["position"],
                generated=today,
            )
        )
    return proposals


# --- Proposer: terrace from the orthophoto --------------------------------------------------


@dataclass(frozen=True)
class VisionPlan:
    """Which targets already have an answer, and which would need a request."""

    cached: dict[str, CachedAnswer]
    to_ask: list[Terrace]


def plan_vision(
    targets: Sequence[Terrace], ortho_cache: Path = ORTHO_CACHE, vision_cache: Path = VISION_CACHE
) -> VisionPlan:
    cached: dict[str, CachedAnswer] = {}
    to_ask: list[Terrace] = []
    for t in sorted(targets, key=lambda t: t.id):
        image = cached_crop(Crop(t.venue), ortho_cache)
        key = None if image is None else answer_key(t.name, t.kind, image)
        answer = None if key is None else read_answer(key, vision_cache)
        if answer is None:
            to_ask.append(t)
        else:
            cached[t.id] = answer
    return VisionPlan(cached=cached, to_ask=to_ask)


def ask_vision(
    to_ask: Sequence[Terrace],
    fetcher: OrthoFetcher,
    asker: Asker,
    today: date,
    vision_cache: Path = VISION_CACHE,
) -> dict[str, CachedAnswer]:
    """Fetch the crop and ask, for each target in order; answers are cached as they come."""
    answers: dict[str, CachedAnswer] = {}
    for i, t in enumerate(to_ask, 1):
        crop = Crop(t.venue)
        image = fetcher.crop(crop)
        if image is None:
            continue
        answer = ask(asker, t.name, t.kind, crop, image, today)
        if answer is None:
            continue
        write_answer(answer_key(t.name, t.kind, image), answer, vision_cache)
        answers[t.id] = answer
        logger.info("vision %d/%d %s: %s", i, len(to_ask), t.id, answer.answer.terrace)
    return answers


def vision_proposals(
    targets: Iterable[Terrace], answers: dict[str, CachedAnswer]
) -> list[Proposal]:
    """`terrace` for "yes" (at the pixel it named), `no_terrace` for "no"; "unsure" is skipped."""
    proposals: list[Proposal] = []
    for t in targets:
        cached = answers.get(t.id)
        if cached is None or cached.answer.terrace == "unsure":
            continue
        a = cached.answer
        location = None
        if a.terrace == "yes" and a.x is not None and a.y is not None:
            location = Crop(t.venue).to_latlon(a.x, a.y)
        proposals.append(
            Proposal(
                venue_id=t.id,
                kind="terrace" if a.terrace == "yes" else "no_terrace",
                lat=None if location is None else location.lat,
                lon=None if location is None else location.lon,
                confidence=a.confidence,
                evidence=re.sub(r"\s+", " ", a.evidence).strip(),
                source=SOURCES["vision"],
                generated=cached.asked,
            )
        )
    return proposals


# --- Running --------------------------------------------------------------------------------


@dataclass(frozen=True)
class Targets:
    """The records each proposer looks at."""

    vision: list[Terrace]
    position: list[Terrace]
    overture: list[Terrace]


def run_proposers(
    targets: Targets,
    only: set[str],
    *,
    ask_limit: int | None,
    today: date,
    asker: Asker | None = None,
) -> tuple[list[Proposal], dict[str, list[str]]]:
    """Every proposal, and per proposer the ids it actually produced an answer for or ran on."""
    proposals: list[Proposal] = []
    ran: dict[str, list[str]] = {}

    if "overture" in only:
        path = cache_path()
        if path.exists():
            proposals += overture_proposals(targets.overture, read_overture_attrs(path), today)
            ran["overture"] = sorted(t.id for t in targets.overture if overture_only(t))
        else:
            logger.warning("no %s: run `python -m solycerveza.overture` first", path)

    if "position" in only:
        try:
            located = load_register()  # the fetch stage: cached in .cache/ after the first run
        except httpx.HTTPError as error:
            logger.warning("position: the Junta register or CartoCiudad failed (%r)", error)
        else:
            proposals += position_proposals(targets.position, located, today)
            ran["position"] = sorted(t.id for t in targets.position)

    if "vision" in only:
        plan = plan_vision(targets.vision)
        low, high = estimate_usd(len(plan.to_ask))
        # The estimate is for the person running it, so it goes to stdout.
        print(
            f"vision: {len(targets.vision)} venues, {len(plan.cached)} answers cached, "
            f"{len(plan.to_ask)} Claude API calls needed (about ${low:.2f}-${high:.2f})"
        )
        answers = dict(plan.cached)
        if plan.to_ask and ask_limit is None:
            print("vision: asking nothing new; re-run with --yes or --limit N")
        elif plan.to_ask and ask_limit is not None and ask_limit != 0:
            chosen = plan.to_ask if ask_limit < 0 else plan.to_ask[:ask_limit]
            with httpx.Client() as client:
                fetcher = OrthoFetcher(client=client)
                answers |= ask_vision(chosen, fetcher, asker or ClaudeAsker(), today)
        proposals += vision_proposals(targets.vision, answers)
        ran["vision"] = sorted(answers)
    return proposals, ran


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Proposals for unreviewed venues (ADR-0008).")
    parser.add_argument(
        "--only",
        default=",".join(PROPOSERS),
        help=f"comma-separated proposers to run (default: {','.join(PROPOSERS)})",
    )
    budget = parser.add_mutually_exclusive_group()
    budget.add_argument("--yes", action="store_true", help="make every Claude API call needed")
    budget.add_argument("--limit", type=int, help="make at most N new Claude API calls")
    parser.add_argument(
        "--min-confidence",
        type=float,
        default=DEFAULT_MIN_CONFIDENCE,
        help="leave out proposals below this confidence (default %(default)s)",
    )
    parser.add_argument(
        "--evaluate",
        action="store_true",
        help="score the proposers against the owner's reviews instead of writing the CSV",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        help="with --evaluate: a terraces.json from before the review (default: build the "
        "pre-review venues from the cached sources)",
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    only = {name.strip() for name in args.only.split(",") if name.strip()}
    unknown = only - set(PROPOSERS)
    if unknown:
        parser.error(f"unknown proposers: {', '.join(sorted(unknown))}")
    ask_limit = -1 if args.yes else args.limit
    today = date.today()

    reviews = read_review()
    if args.evaluate:
        # Imported here: proposals_eval imports this module.
        from solycerveza.proposals_eval import evaluate, evaluation_targets

        baseline = read_records(args.baseline) if args.baseline else pre_review_records()
        targets = evaluation_targets(baseline, reviews)
        proposals, ran = run_proposers(targets, only, ask_limit=ask_limit, today=today)
        write_proposals(proposals, EVAL_CSV)
        report = evaluate(proposals, ran, baseline, reviews)
        EVAL_REPORT.parent.mkdir(parents=True, exist_ok=True)
        EVAL_REPORT.write_text(report, encoding="utf-8")
        print(report, end="")
        logger.info("report -> %s; proposals -> %s", EVAL_REPORT, EVAL_CSV)
        return 0

    reviewed = {r.venue_id for r in reviews}
    records = [t for t in read_records(TERRACES_JSON) if t.id not in reviewed]
    targets = Targets(
        vision=[t for t in records if t.terrace is None],
        position=records,
        overture=[t for t in records if overture_only(t)],
    )
    proposals, _ = run_proposers(targets, only, ask_limit=ask_limit, today=today)
    kept = [p for p in proposals if p.confidence >= args.min_confidence]
    # Proposers that did not run this time keep their earlier rows.
    old = read_proposals()
    rerun = {SOURCES[name] for name in only}
    rows = [p for p in old if p.source not in rerun and p.venue_id not in reviewed]
    rows += keep_dates(old, kept)
    write_proposals(rows)
    logger.info(
        "%d proposals (%d below %.2f left out) -> %s",
        len(rows),
        len(proposals) - len(kept),
        args.min_confidence,
        PROPOSALS_CSV,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

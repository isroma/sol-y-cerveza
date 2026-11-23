"""Venue review decisions made in the local admin view (`cd web && npm run admin`).

The admin view writes `pipeline/data/venue_review.csv` (UTF-8, header required, one row per
venue, sorted by `venue_id`). The build applies it last, so a review wins over the curated list,
OSM tags and the other sources:

- `venue_id`: the reviewed venue (`osm:…`, `overture:…` or `junta:…`), or `review:<slug>` for a
  venue no source lists, added in the admin view.
- `status`: `terrace`, `no_terrace`, `not_venue` (closed, or not a bar or restaurant: the venue is
  dropped), or empty when only the venue position was fixed.
- `name`, `kind`: only for `review:` venues, and required there.
- `venue_lat`, `venue_lon`: the corrected venue position, or both empty to keep the source's.
- `terrace_lat`, `terrace_lon`: where the tables are, for `terrace` (both empty keeps the current
  terrace position, or the venue position when there is none).
- `reviewed`: YYYY-MM-DD of the decision.
"""

import csv
import logging
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from solycerveza.terraces import Terrace
from solycerveza.venues import VENUE_ID_PATTERN, Kind, Lat, LatLon, Lon, Venue

logger = logging.getLogger(__name__)

REVIEW_CSV = Path(__file__).resolve().parents[2] / "data" / "venue_review.csv"
COLUMNS = (
    "venue_id",
    "status",
    "name",
    "kind",
    "venue_lat",
    "venue_lon",
    "terrace_lat",
    "terrace_lon",
    "reviewed",
)

Status = Literal["terrace", "no_terrace", "not_venue"]


class Review(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    status: Status | None = None
    name: str | None = None
    kind: Kind | None = None
    venue_lat: Lat | None = None
    venue_lon: Lon | None = None
    terrace_lat: Lat | None = None
    terrace_lon: Lon | None = None
    reviewed: date

    @model_validator(mode="after")
    def _pairs(self) -> Self:
        if (self.venue_lat is None) != (self.venue_lon is None):
            raise ValueError("venue_lat and venue_lon go together")
        if (self.terrace_lat is None) != (self.terrace_lon is None):
            raise ValueError("terrace_lat and terrace_lon go together")
        if self.terrace_lat is not None and self.status != "terrace":
            raise ValueError("a terrace position needs status terrace")
        added = self.venue_id.startswith("review:")
        if added and (self.name is None or self.kind is None or self.venue_lat is None):
            raise ValueError("an added venue needs a name, a kind and a venue position")
        if added and self.status == "not_venue":
            raise ValueError("delete the row instead of marking an added venue not_venue")
        if not added and (self.name is not None or self.kind is not None):
            raise ValueError("name and kind are only for added (review:) venues")
        if self.status is None and self.venue_lat is None:
            raise ValueError("a row needs a status or a venue position")
        return self

    @property
    def venue(self) -> LatLon | None:
        if self.venue_lat is None or self.venue_lon is None:
            return None
        return LatLon(lat=self.venue_lat, lon=self.venue_lon)

    @property
    def terrace(self) -> LatLon | None:
        if self.terrace_lat is None or self.terrace_lon is None:
            return None
        return LatLon(lat=self.terrace_lat, lon=self.terrace_lon)


def read_review(path: Path = REVIEW_CSV) -> list[Review]:
    """The review rows, or none when the file does not exist yet."""
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(COLUMNS)}")
        reviews: list[Review] = []
        for row in reader:
            cells = {k: (v or "").strip() or None for k, v in row.items()}
            try:
                reviews.append(Review.model_validate(cells))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    ids = [r.venue_id for r in reviews]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ValueError(f"{path}: duplicate venue_id {', '.join(duplicates)}")
    return reviews


def dropped_ids(reviews: Sequence[Review]) -> set[str]:
    return {r.venue_id for r in reviews if r.status == "not_venue"}


def review_venues(venues: Sequence[Venue], reviews: Sequence[Review]) -> list[Venue]:
    """Venues without the `not_venue` ones, with corrected positions, plus the added ones."""
    by_id = {r.venue_id: r for r in reviews if not r.venue_id.startswith("review:")}
    for stale in sorted(set(by_id) - {v.id for v in venues}):
        logger.warning("venue review for %s: no such venue any more, remove the row", stale)
    dropped = dropped_ids(reviews)
    result: list[Venue] = []
    for venue in venues:
        review = by_id.get(venue.id)
        if venue.id in dropped:
            continue
        if review is not None and review.venue is not None:
            venue = venue.model_copy(update={"location": review.venue})
        result.append(venue)
    for review in reviews:
        if review.venue_id.startswith("review:"):
            # The validator guarantees these for added venues; the asserts narrow the types.
            assert review.venue is not None
            assert review.kind is not None
            result.append(
                Venue(
                    id=review.venue_id,
                    name=review.name,
                    kind=review.kind,
                    location=review.venue,
                    outdoor_seating=None,
                )
            )
    return result


def review_terraces(terraces: Sequence[Terrace], reviews: Sequence[Review]) -> list[Terrace]:
    """Records with reviewed terraces set (`terrace`) or cleared (`no_terrace`)."""
    by_id = {r.venue_id: r for r in reviews}
    result: list[Terrace] = []
    for t in terraces:
        review = by_id.get(t.id)
        if review is None or review.status is None:
            result.append(t)
        elif review.status == "no_terrace":
            result.append(t.model_copy(update={"terrace": None, "verified": None}))
        elif review.status == "terrace":
            position = review.terrace or t.terrace or t.venue
            sources = sorted({*t.sources, "review"})
            result.append(t.model_copy(update={"terrace": position, "sources": sources}))
        else:
            result.append(t)
    return result

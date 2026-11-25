"""Build the base records: OSM venues merged with the hand-curated terrace list.

Every named venue gets a record. It has a terrace (`terrace` set) when OSM tags it
`outdoor_seating=yes` or when a row in the curated list describes it; otherwise `terrace` is
null (the app shows "terraza sin confirmar", unconfirmed terrace). `horizon` stays null here; a
later stage computes it.

Curated list (`pipeline/data/curated_terraces.csv`, UTF-8, one row per terrace, header required):

- `id`: stable slug (`[a-z0-9]` words joined by `-`), e.g. `plaza-alta-la-terraza`.
- `venue_id`: optional link to a venue: OSM (`osm:node/123`, `osm:way/456`), Overture
  (`overture:<GERS id>`), the Junta register (`junta:<hash>`) or the admin view (`review:<slug>`).
  A linked record keeps that id and its source; an unlinked one becomes `curated:<id>`.
  A link to a venue missing from the downloads is an error, so ids never change silently.
- `name`, `kind`: optional when `venue_id` is set (the venue's values are used), required
  otherwise. When given they override the venue's. `kind` is one of bar, pub, cafe,
  restaurant, biergarten.
- `terrace_lat`, `terrace_lon`: WGS84 position of the tables (required). It always wins over the
  venue position, because the horizon is computed from here.
- `verified`: optional YYYY-MM-DD of the last on-site check of the terrace position.
- `ayto_ref`: optional reference of the Ayuntamiento's terrace authorization (from the register,
  ADR-0002), used to match register entries to rows; unique, not exported.
- `notes`: optional free text for curators; not exported.

An unlinked row has no venue position of its own, so its `venue` equals its `terrace`. An
OSM-only record uses the venue position for both, which is only a rough terrace position.

Run `python -m solycerveza.terraces [--refresh]` to write `pipeline/.cache/terraces_base.json`.
"""

import argparse
import json
import logging
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from solycerveza.csvfile import read_rows
from solycerveza.geo import distance_m
from solycerveza.overture import name_similarity
from solycerveza.prices import Price
from solycerveza.venues import (
    CACHE_DIR,
    VENUE_ID_ALTERNATIVES,
    VENUE_ID_PATTERN,
    Kind,
    Lat,
    LatLon,
    Lon,
    SeatingArea,
    Venue,
    load_venues,
    venue_source,
)

logger = logging.getLogger(__name__)

CURATED_CSV = Path(__file__).resolve().parents[2] / "data" / "curated_terraces.csv"
CURATED_COLUMNS = (
    "id",
    "venue_id",
    "name",
    "kind",
    "terrace_lat",
    "terrace_lon",
    "verified",
    "ayto_ref",
    "notes",
)
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
# Every venue id, plus unlinked curated rows and sample data.
TERRACE_ID_PATTERN = rf"^({VENUE_ID_ALTERNATIVES}|(curated|sample):[a-z0-9]+(-[a-z0-9]+)*)$"

Horizon = Annotated[
    list[Annotated[int, Field(ge=0, le=900)]], Field(min_length=360, max_length=360)
]


class CuratedTerrace(BaseModel):
    """One row of the curated terrace list."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=SLUG_PATTERN)]
    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)] | None = None
    name: str | None = None
    kind: Kind | None = None
    terrace_lat: Lat
    terrace_lon: Lon
    verified: date | None = None
    ayto_ref: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _unlinked_rows_need_name_and_kind(self) -> Self:
        if self.venue_id is None and (self.name is None or self.kind is None):
            raise ValueError("name and kind are required when venue_id is empty")
        return self

    @property
    def terrace(self) -> LatLon:
        return LatLon(lat=self.terrace_lat, lon=self.terrace_lon)


class Terrace(BaseModel):
    """A terrace record, mirroring `Terrace` in docs/data-contract.md (field order included)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=TERRACE_ID_PATTERN)]
    name: Annotated[str, Field(min_length=1)]
    kind: Kind
    venue: LatLon
    terrace: LatLon | None
    sources: Annotated[list[str], Field(min_length=1)]
    verified: date | None
    horizon: Horizon | None = None
    # Leaf-off profile (ADR-0007); None when it equals `horizon` or was not computed.
    horizon_winter: Horizon | None = None
    prices: list[Price] = Field(default_factory=list)

    @model_validator(mode="after")
    def _no_terrace_means_no_terrace_data(self) -> Self:
        if self.terrace is None and (self.verified is not None or self.horizon is not None):
            raise ValueError("verified and horizon must be null when terrace is null")
        if self.horizon is None and self.horizon_winter is not None:
            raise ValueError("horizon_winter needs a horizon")
        return self


def read_curated(path: Path = CURATED_CSV) -> list[CuratedTerrace]:
    """Read and validate the curated terrace list. Empty cells mean "not set"."""
    # The file must exist. Cells a short row lacks are left out, so the model's defaults apply.
    rows = read_rows(
        path,
        CURATED_COLUMNS,
        CuratedTerrace,
        clean=lambda row: {k: v.strip() or None for k, v in row.items() if v is not None},
    )

    for column, values in (
        ("id", [row.id for row in rows]),
        ("venue_id", [row.venue_id for row in rows if row.venue_id is not None]),
        ("ayto_ref", [row.ayto_ref for row in rows if row.ayto_ref is not None]),
    ):
        duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
        if duplicates:
            raise ValueError(f"{path}: duplicate {column}: {', '.join(duplicates)}")
    return rows


#: An outdoor-seating area belongs to the nearest venue within this distance.
SEATING_LINK_M = 40.0


def _seating_positions(
    terraces: Sequence[Terrace], seating: Iterable[SeatingArea]
) -> dict[str, LatLon]:
    """Venue id -> position of its outdoor-seating area (nearest venue, matching name first)."""
    positions: dict[str, tuple[float, LatLon]] = {}
    for area in seating:
        near = [
            (distance_m(area.location, t.venue), t)
            for t in terraces
            if distance_m(area.location, t.venue) <= SEATING_LINK_M
        ]
        if not near:
            continue
        named = [(d, t) for d, t in near if area.name and name_similarity(area.name, t.name) >= 80]
        d, owner = min(named or near, key=lambda pair: (pair[0], pair[1].id))
        if owner.id not in positions or d < positions[owner.id][0]:
            positions[owner.id] = (d, area.location)
    return {venue_id: location for venue_id, (_, location) in positions.items()}


def build_terraces(
    venues: Iterable[Venue],
    curated: Iterable[CuratedTerrace],
    seating: Iterable[SeatingArea] = (),
) -> list[Terrace]:
    """Merge venues and curated rows into records sorted by id, one per named venue."""
    venues_by_id = {venue.id: venue for venue in venues}
    rows = list(curated)
    linked = {row.venue_id: row for row in rows if row.venue_id is not None}
    unknown = sorted(venue_id for venue_id in linked if venue_id not in venues_by_id)
    if unknown:
        raise ValueError(
            f"curated rows link venues missing from the downloads: {', '.join(unknown)}"
        )

    terraces: list[Terrace] = []
    for venue in venues_by_id.values():
        row = linked.get(venue.id)
        if row is not None:
            terraces.append(_linked(venue, row))
        elif venue.name is None:
            if venue.outdoor_seating == "yes":
                logger.warning("skipping %s: outdoor_seating=yes but no name", venue.id)
        else:
            terraces.append(_osm_only(venue, venue.name))
    terraces.extend(_curated_only(row) for row in rows if row.venue_id is None)

    # OSM outdoor-seating areas place the terrace where the tables are, unless curated.
    curated_ids = set(linked) | {f"curated:{row.id}" for row in rows if row.venue_id is None}
    positions = _seating_positions(terraces, seating)
    terraces = [
        t.model_copy(update={"terrace": positions[t.id]})
        if t.id in positions and t.id not in curated_ids
        else t
        for t in terraces
    ]
    return sorted(terraces, key=lambda terrace: terrace.id)


def _linked(venue: Venue, row: CuratedTerrace) -> Terrace:
    name = row.name or venue.name
    if name is None:
        raise ValueError(f"curated row {row.id}: {venue.id} has no name in OSM, set one")
    return Terrace(
        id=venue.id,
        name=name,
        kind=row.kind or venue.kind,
        venue=venue.location,
        terrace=row.terrace,
        sources=sorted({"curated", venue_source(venue.id)}),
        verified=row.verified,
    )


def _osm_only(venue: Venue, name: str) -> Terrace:
    # `outdoor_seating=yes` without a curated row: the venue position is a rough terrace position.
    has_terrace = venue.outdoor_seating == "yes"
    return Terrace(
        id=venue.id,
        name=name,
        kind=venue.kind,
        venue=venue.location,
        terrace=venue.location if has_terrace else None,
        sources=[venue_source(venue.id)],
        verified=None,
    )


def _curated_only(row: CuratedTerrace) -> Terrace:
    # The model validator guarantees both for unlinked rows; the asserts narrow the types.
    assert row.name is not None
    assert row.kind is not None
    return Terrace(
        id=f"curated:{row.id}",
        name=row.name,
        kind=row.kind,
        venue=row.terrace,
        terrace=row.terrace,
        sources=["curated"],
        verified=row.verified,
    )


def write_terraces(terraces: Sequence[Terrace], path: Path) -> None:
    """Write the records as a JSON array: UTF-8, 2-space indent, trailing newline."""
    records = [terrace.model_dump(mode="json") for terrace in terraces]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(records, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the base terrace records.")
    parser.add_argument(
        "--refresh", action="store_true", help="download from Overpass even if a cache exists"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    venues = load_venues(refresh=args.refresh)
    curated = read_curated()
    terraces = build_terraces(venues, curated)
    output = CACHE_DIR / "terraces_base.json"
    write_terraces(terraces, output)
    logger.info(
        "%d venues, %d curated rows -> %d terraces in %s",
        len(venues),
        len(curated),
        len(terraces),
        output,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

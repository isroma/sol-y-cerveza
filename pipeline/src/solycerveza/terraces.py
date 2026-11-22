"""Build the base terrace records: OSM venues merged with the hand-curated terrace list.

A terrace record exists when OSM tags the venue `outdoor_seating=yes` or when a row in the
curated list describes it. `horizon` stays null here; a later stage computes it.

Curated list (`pipeline/data/curated_terraces.csv`, UTF-8, one row per terrace, header required):

- `id`: stable slug (`[a-z0-9]` words joined by `-`), e.g. `plaza-alta-la-terraza`.
- `osm_id`: optional link to an OSM venue, e.g. `osm:node/123` or `osm:way/456`. A linked record
  uses the OSM id; an unlinked one becomes `curated:<id>`. A link to a venue missing from the
  Overpass download is an error, so ids never change silently.
- `name`, `kind`: optional when `osm_id` is set (the OSM values are used), required otherwise.
  When given they override OSM. `kind` is one of bar, pub, cafe, restaurant, biergarten.
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
import csv
import json
import logging
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Annotated, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from solycerveza.venues import CACHE_DIR, Kind, Lat, LatLon, Lon, Venue, load_venues

logger = logging.getLogger(__name__)

CURATED_CSV = Path(__file__).resolve().parents[2] / "data" / "curated_terraces.csv"
CURATED_COLUMNS = (
    "id",
    "osm_id",
    "name",
    "kind",
    "terrace_lat",
    "terrace_lon",
    "verified",
    "ayto_ref",
    "notes",
)
SLUG_PATTERN = r"^[a-z0-9]+(-[a-z0-9]+)*$"
OSM_ID_PATTERN = r"^osm:(node|way)/\d+$"
TERRACE_ID_PATTERN = r"^(osm:(node|way)/\d+|(curated|sample):[a-z0-9]+(-[a-z0-9]+)*)$"

Horizon = Annotated[
    list[Annotated[int, Field(ge=0, le=900)]], Field(min_length=360, max_length=360)
]


class CuratedTerrace(BaseModel):
    """One row of the curated terrace list."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=SLUG_PATTERN)]
    osm_id: Annotated[str, Field(pattern=OSM_ID_PATTERN)] | None = None
    name: str | None = None
    kind: Kind | None = None
    terrace_lat: Lat
    terrace_lon: Lon
    verified: date | None = None
    ayto_ref: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def _unlinked_rows_need_name_and_kind(self) -> Self:
        if self.osm_id is None and (self.name is None or self.kind is None):
            raise ValueError("name and kind are required when osm_id is empty")
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
    terrace: LatLon
    sources: Annotated[list[str], Field(min_length=1)]
    verified: date | None
    horizon: Horizon | None = None


def read_curated(path: Path = CURATED_CSV) -> list[CuratedTerrace]:
    """Read and validate the curated terrace list. Empty cells mean "not set"."""
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != CURATED_COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(CURATED_COLUMNS)}")
        rows: list[CuratedTerrace] = []
        for row in reader:
            if None in row:
                raise ValueError(f"{path}:{reader.line_num}: more cells than columns")
            cells = {key: value.strip() or None for key, value in row.items() if value is not None}
            try:
                rows.append(CuratedTerrace.model_validate(cells))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error

    for column, values in (
        ("id", [row.id for row in rows]),
        ("osm_id", [row.osm_id for row in rows if row.osm_id is not None]),
        ("ayto_ref", [row.ayto_ref for row in rows if row.ayto_ref is not None]),
    ):
        duplicates = sorted(value for value, count in Counter(values).items() if count > 1)
        if duplicates:
            raise ValueError(f"{path}: duplicate {column}: {', '.join(duplicates)}")
    return rows


def build_terraces(venues: Iterable[Venue], curated: Iterable[CuratedTerrace]) -> list[Terrace]:
    """Merge venues and curated rows into terrace records sorted by id."""
    venues_by_id = {venue.id: venue for venue in venues}
    rows = list(curated)
    linked = {row.osm_id: row for row in rows if row.osm_id is not None}
    unknown = sorted(osm_id for osm_id in linked if osm_id not in venues_by_id)
    if unknown:
        raise ValueError(f"curated rows link venues missing from OSM: {', '.join(unknown)}")

    terraces: list[Terrace] = []
    for venue in venues_by_id.values():
        row = linked.get(venue.id)
        if row is not None:
            terraces.append(_linked(venue, row))
        elif venue.outdoor_seating == "yes":
            if venue.name is None:
                logger.warning("skipping %s: outdoor_seating=yes but no name", venue.id)
                continue
            terraces.append(_osm_only(venue, venue.name))
    terraces.extend(_curated_only(row) for row in rows if row.osm_id is None)
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
        sources=["curated", "osm"],
        verified=row.verified,
    )


def _osm_only(venue: Venue, name: str) -> Terrace:
    return Terrace(
        id=venue.id,
        name=name,
        kind=venue.kind,
        venue=venue.location,
        terrace=venue.location,
        sources=["osm"],
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

"""Curated corrections to the venue sources: venues to drop.

Open datasets get things wrong: Overture has duplicates and misplaced places, and the Junta
register keeps closed venues. Curators list such venues in `pipeline/data/venue_corrections.csv`
(UTF-8, header required):

- `venue_id`: the venue to correct (`osm:…`, `overture:…` or `junta:…`).
- `action`: `drop` (the only action so far): remove the venue from the dataset.
- `notes`: required: what is wrong and how it is known.

Wrong OSM venues should be fixed in OSM instead; `drop` is meant for Overture and Junta records.
"""

import csv
import logging
from collections.abc import Sequence
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from solycerveza.venues import VENUE_ID_PATTERN, Venue

logger = logging.getLogger(__name__)

CORRECTIONS_CSV = Path(__file__).resolve().parents[2] / "data" / "venue_corrections.csv"
COLUMNS = ("venue_id", "action", "notes")


class Correction(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    action: Literal["drop"]
    notes: Annotated[str, Field(min_length=1)]


def read_corrections(path: Path = CORRECTIONS_CSV) -> list[Correction]:
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(COLUMNS)}")
        corrections: list[Correction] = []
        for row in reader:
            try:
                corrections.append(
                    Correction.model_validate({k: (v or "").strip() for k, v in row.items()})
                )
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    return corrections


def apply_corrections(venues: Sequence[Venue], corrections: Sequence[Correction]) -> list[Venue]:
    """Venues without the dropped ones. A correction for an unknown venue is logged, not fatal."""
    dropped = {c.venue_id for c in corrections if c.action == "drop"}
    known = {venue.id for venue in venues}
    for stale in sorted(dropped - known):
        logger.warning("venue correction for %s: no such venue any more, remove the row", stale)
    return [venue for venue in venues if venue.id not in dropped]

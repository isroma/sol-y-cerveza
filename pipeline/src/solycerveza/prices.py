"""Beer prices per venue, entered in the local admin view (`cd web && npm run admin`).

`pipeline/data/venue_prices.csv` (UTF-8, header required, sorted by venue, item and brand) has
one row per venue, item and brand:

- `venue_id`: the venue (`osm:…`, `overture:…`, `junta:…` or `review:…`).
- `item`: `cana` (a draught caña) or `tercio` (a 33 cl bottle).
- `brand`: required for a tercio, one of `BRANDS`; empty for a caña.
- `cents`: the price in euro cents, an integer (no floating point for money).
- `seen`: YYYY-MM-DD of when the price was seen.

The build attaches the prices to each venue record. Prices that users suggest live in the
suggestions backend instead and reach the app at runtime (see `api/`).
"""

import csv
import logging
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from solycerveza.venues import VENUE_ID_PATTERN

logger = logging.getLogger(__name__)

PRICES_CSV = Path(__file__).resolve().parents[2] / "data" / "venue_prices.csv"
COLUMNS = ("venue_id", "item", "brand", "cents", "seen")

Item = Literal["cana", "tercio"]
# The tercio brands most poured in Spain and in Badajoz; Portuguese ones are common at the border.
# Keep in sync with BRANDS in web/src/data/prices.ts.
Brand = Literal[
    "cruzcampo",
    "mahou-5-estrellas",
    "estrella-galicia",
    "amstel",
    "heineken",
    "alhambra-especial",
    "san-miguel",
    "estrella-damm",
    "super-bock",
    "sagres",
]


class Price(BaseModel):
    """A price as the app shows it, mirroring `Price` in docs/data-contract.md."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    item: Item
    brand: Brand | None
    cents: Annotated[int, Field(ge=50, le=1500)]
    seen: date

    @model_validator(mode="after")
    def _brand_for_tercio(self) -> Self:
        if (self.item == "tercio") != (self.brand is not None):
            raise ValueError("a tercio needs a brand and a caña has none")
        return self


class VenuePrice(Price):
    """A row of `venue_prices.csv`."""

    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]


def read_prices(path: Path = PRICES_CSV) -> list[VenuePrice]:
    """The price rows, or none when the file does not exist yet."""
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(COLUMNS)}")
        rows: list[VenuePrice] = []
        for row in reader:
            cells = {k: (v or "").strip() or None for k, v in row.items()}
            try:
                rows.append(VenuePrice.model_validate(cells))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    keys = [(r.venue_id, r.item, r.brand) for r in rows]
    duplicates = sorted({f"{k[0]} {k[1]} {k[2] or ''}" for k in keys if keys.count(k) > 1})
    if duplicates:
        raise ValueError(f"{path}: duplicate rows: {', '.join(duplicates)}")
    return rows


def prices_by_venue(rows: Sequence[VenuePrice], known: set[str]) -> dict[str, list[Price]]:
    """Venue id -> its prices (caña first, then tercios by brand). Unknown venues are logged."""
    for stale in sorted({r.venue_id for r in rows} - known):
        logger.warning("venue price for %s: no such venue any more, remove its rows", stale)
    result: dict[str, list[Price]] = {}
    for row in sorted(rows, key=lambda r: (r.venue_id, r.item, r.brand or "")):
        if row.venue_id in known:
            price = Price(item=row.item, brand=row.brand, cents=row.cents, seen=row.seen)
            result.setdefault(row.venue_id, []).append(price)
    return result

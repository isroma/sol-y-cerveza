"""Accepted sun reports as horizon caps per terrace (issue #463, ADR-0012).

A visitor who says "the sun is on this terrace now" reports where the sun was: its azimuth and
altitude, in the season (leaf-off or not) of that day. The API serves accepted reports as
confirmed caps (`api/src/sun.ts`); the admin also records them in
`pipeline/data/sun_corrections.csv` (UTF-8, header required, sorted by `id`), one row per
accepted report:

- `id`: the API's report id, a positive integer, unique in the file.
- `venue_id`: the venue, as in `terraces.json`.
- `leaf_off`: `0` or `1`, the season the report was made in.
- `azimuth`, `altitude`: the sun's position in degrees, to 1 decimal.
- `seen`: the report's instant, ISO 8601 UTC (`2026-11-25T12:31:04.000Z`).

The build turns them into each terrace's `sun_corrections` with the API's rules, so the app
applies the same caps with or without the API: each report covers the horizon bins within
`SPREAD_DEGREES` of its azimuth; a bin's cap is the lowest altitude there less `MARGIN_DEGREES`,
in tenths of a degree; adjacent bins with the same cap merge into one run, across north too.
Reports older than `WINDOW_DAYS` before the build's `generated` instant stop counting.
"""

import logging
import math
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated

from pydantic import (
    AliasChoices,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from solycerveza.csvfile import blank_to_none, read_rows
from solycerveza.venues import VENUE_ID_PATTERN

logger = logging.getLogger(__name__)

SUN_CORRECTIONS_CSV = Path(__file__).resolve().parents[2] / "data" / "sun_corrections.csv"
COLUMNS = ("id", "venue_id", "leaf_off", "azimuth", "altitude", "seen")

# The API's rules (api/src/sun.ts): SUN_SPREAD_DEGREES, SUN_MARGIN_DEGREES, SUN_WINDOW_DAYS.
SPREAD_DEGREES = 5
MARGIN_DEGREES = 2
WINDOW_DAYS = 365
BINS = 360

Bin = Annotated[int, Field(ge=0, le=BINS - 1)]


class SunCorrection(BaseModel):
    """A run of capped horizon bins, mirroring `SunCorrection` in docs/data-contract.md.

    `from` and `to` are inclusive bins (a run across north has from > to); `altitude` is the
    cap in tenths of a degree, the margin already off.
    """

    model_config = ConfigDict(frozen=True, extra="forbid", serialize_by_alias=True)

    leaf_off: bool
    # `from` is a keyword in Python: the field is `from_`, written and read as "from".
    from_: Bin = Field(validation_alias=AliasChoices("from", "from_"), serialization_alias="from")
    to: Bin
    altitude: Annotated[int, Field(ge=0, le=900)]


class SunReport(BaseModel):
    """A row of `sun_corrections.csv`."""

    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)

    id: Annotated[int, Field(gt=0)]
    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    leaf_off: bool
    azimuth: Annotated[float, Field(ge=0, lt=360)]
    altitude: Annotated[float, Field(ge=0, le=90)]
    seen: AwareDatetime

    @field_validator("leaf_off", mode="before")
    @classmethod
    def _zero_or_one(cls, value: object) -> object:
        # Only the file's own spelling, not pydantic's "true"/"yes"/"on".
        if isinstance(value, str):
            if value not in ("0", "1"):
                raise ValueError("leaf_off must be 0 or 1")
            return value == "1"
        return value


def read_sun_reports(path: Path = SUN_CORRECTIONS_CSV) -> list[SunReport]:
    """The accepted reports, sorted by id, or none when the file does not exist yet."""
    if not path.exists():
        return []
    rows = read_rows(path, COLUMNS, SunReport, clean=blank_to_none)
    ids = [r.id for r in rows]
    duplicates = sorted({i for i in ids if ids.count(i) > 1})
    if duplicates:
        raise ValueError(f"{path}: duplicate id: {', '.join(map(str, duplicates))}")
    return sorted(rows, key=lambda r: r.id)


def horizon_bin(azimuth: float) -> int:
    """The bin of a compass azimuth, as `horizonBin` in the API (JS rounds halves up)."""
    return math.floor(azimuth + 0.5) % BINS


def cap_tenths(altitude: float) -> int:
    """The cap for a sighting at `altitude` degrees, in tenths of a degree: margin off, floored.

    The epsilon keeps 27.1 - 2 from flooring to 250 through binary rounding, as in the API.
    """
    return max(0, math.floor((altitude - MARGIN_DEGREES) * 10 + 1e-9))


def _bin_caps(reports: Sequence[SunReport]) -> list[int | None]:
    """Per bin, the cap from the lowest report within the spread, or None without one."""
    lowest: list[float | None] = [None] * BINS
    for report in reports:
        centre = horizon_bin(report.azimuth)
        for d in range(-SPREAD_DEGREES, SPREAD_DEGREES + 1):
            b = (centre + d) % BINS
            current = lowest[b]
            if current is None or report.altitude < current:
                lowest[b] = report.altitude
    return [None if a is None else cap_tenths(a) for a in lowest]


def _runs(caps: Sequence[int | None]) -> list[tuple[int, int, int]]:
    """Adjacent bins with the same cap as (from, to, cap); a run across north is one run."""
    found: list[list[int]] = []
    for i, cap in enumerate(caps):
        if cap is None:
            continue
        last = found[-1] if found else None
        if last is not None and last[2] == cap and last[1] == i - 1:
            last[1] = i
        else:
            found.append([i, i, cap])
    first, last = (found[0], found[-1]) if len(found) > 1 else (None, None)
    if first and last and first[0] == 0 and last[1] == BINS - 1 and first[2] == last[2]:
        found.pop(0)
        last[1] = first[1]
    return [(r[0], r[1], r[2]) for r in found]


def sun_corrections_by_venue(
    reports: Sequence[SunReport],
    known: Mapping[str, bool],
    generated: datetime,
) -> dict[str, list[SunCorrection]]:
    """Venue id -> its runs, sorted by season (not leaf-off first), then `from`.

    `known` maps each venue in the output to whether it has a horizon; reports for other venues,
    or for one without a horizon, are logged and left out, and so are reports seen more than
    `WINDOW_DAYS` before `generated`.
    """
    since = generated - timedelta(days=WINDOW_DAYS)
    live = [r for r in reports if r.seen >= since]
    for venue_id in sorted({r.venue_id for r in live} - known.keys()):
        logger.warning("sun correction for %s: no such venue any more, remove its rows", venue_id)
    for venue_id in sorted({r.venue_id for r in live if known.get(r.venue_id) is False}):
        logger.warning("sun correction for %s: the venue has no horizon, ignored", venue_id)
    groups: dict[tuple[str, bool], list[SunReport]] = {}
    for report in live:
        if known.get(report.venue_id):
            groups.setdefault((report.venue_id, report.leaf_off), []).append(report)
    result: dict[str, list[SunCorrection]] = {}
    for venue_id, leaf_off in sorted(groups):
        for start, end, cap in _runs(_bin_caps(groups[(venue_id, leaf_off)])):
            result.setdefault(venue_id, []).append(
                SunCorrection(leaf_off=leaf_off, from_=start, to=end, altitude=cap)
            )
    return result

"""Accepted sun reports as horizon caps per terrace (issue #463, ADR-0012), and accepted shade
reports as floors (issue #527, ADR-0014).

A visitor who says "the sun is on this terrace now" reports where the sun was: its azimuth and
altitude, in the season (leaf-off or not) of that day. The API serves accepted reports as
confirmed caps (`api/src/sun.ts`); the admin also records them in
`pipeline/data/sun_corrections.csv` (UTF-8, header required, sorted by `id`), one row per
accepted report:

- `id`: the API's report id, a positive integer, unique in the file.
- `venue_id`: the venue, as in `terraces.json`.
- `leaf_off`: `0` or `1`, the season the report was made in.
- `azimuth`, `altitude`: the sun's position in degrees, to 1 decimal; azimuth 0 to 360 (360.0,
  from rounding, is north like 0), altitude 0 to 90.
- `seen`: the report's instant, ISO 8601 UTC (`2026-11-25T12:31:04.000Z`).
- `kind`: `sun` (sun seen where the model says shade) or `shade` (shade seen with the sun out).
  A file from before #527 has no `kind` column: every row is `sun`.

The build turns them into each terrace's `sun_corrections` with the API's rules, so the app
applies the same caps with or without the API: each report covers the horizon bins within
`SPREAD_DEGREES` of its azimuth; a bin's cap is the lowest altitude there less `MARGIN_DEGREES`,
in tenths of a degree; adjacent bins with the same cap merge into one run, across north too.
Reports older than `WINDOW_DAYS` before the build's `generated` instant stop counting.

Shade reports become each terrace's `shade_corrections` the same way, mirrored: each covers the
bins within `SHADE_SPREAD_DEGREES` of its azimuth; a bin's floor is the highest altitude there,
rounded up to tenths of a degree, with no margin.
"""

import logging
import math
from collections.abc import Mapping, Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Annotated, Literal

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
COLUMNS = ("id", "venue_id", "leaf_off", "azimuth", "altitude", "seen", "kind")
# The header before shade reports (#527): every row is a sun report.
SUN_ONLY_COLUMNS = COLUMNS[:-1]

# The API's rules (api/src/sun.ts): SUN_SPREAD_DEGREES, SUN_MARGIN_DEGREES, SUN_WINDOW_DAYS.
SPREAD_DEGREES = 5
# api/src/sun.ts SHADE_SPREAD_DEGREES (ADR-0014).
SHADE_SPREAD_DEGREES = 2
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
    # 360.0 is allowed: the API rounds to 1 decimal, so 359.95 and above arrive as 360.0 (bin 0).
    azimuth: Annotated[float, Field(ge=0, le=360)]
    altitude: Annotated[float, Field(ge=0, le=90)]
    seen: AwareDatetime
    kind: Literal["sun", "shade"] = "sun"

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
    rows = read_rows(path, COLUMNS, SunReport, clean=blank_to_none, legacy=(SUN_ONLY_COLUMNS,))
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


def floor_tenths(altitude: float) -> int:
    """The floor for shade seen at `altitude` degrees, in tenths of a degree: rounded up, at most
    90°, as `floorTenths` in the API (the epsilon keeps 27.1 from rounding up to 272)."""
    return min(900, max(0, math.ceil(altitude * 10 - 1e-9)))


def _bin_caps(reports: Sequence[SunReport], shade: bool = False) -> list[int | None]:
    """Per bin, the cap from the lowest report within the spread (for shade, the floor from the
    highest), or None without one."""
    spread = SHADE_SPREAD_DEGREES if shade else SPREAD_DEGREES
    best: list[float | None] = [None] * BINS
    for report in reports:
        centre = horizon_bin(report.azimuth)
        for d in range(-spread, spread + 1):
            b = (centre + d) % BINS
            current = best[b]
            if (
                current is None
                or (shade and report.altitude > current)
                or (not shade and report.altitude < current)
            ):
                best[b] = report.altitude
    level = floor_tenths if shade else cap_tenths
    return [None if a is None else level(a) for a in best]


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
    kind: Literal["sun", "shade"] = "sun",
) -> dict[str, list[SunCorrection]]:
    """Venue id -> its runs of `kind` (caps for sun, floors for shade), sorted by season (not
    leaf-off first), then `from`.

    `known` maps each venue in the output to whether it has a horizon; reports for other venues,
    or for one without a horizon, are logged and left out, and so are reports seen more than
    `WINDOW_DAYS` before `generated`.
    """
    since = generated - timedelta(days=WINDOW_DAYS)
    live = [r for r in reports if r.seen >= since and r.kind == kind]
    for venue_id in sorted({r.venue_id for r in live} - known.keys()):
        logger.warning(
            "%s correction for %s: no such venue any more, remove its rows", kind, venue_id
        )
    for venue_id in sorted({r.venue_id for r in live if known.get(r.venue_id) is False}):
        logger.warning("%s correction for %s: the venue has no horizon, ignored", kind, venue_id)
    groups: dict[tuple[str, bool], list[SunReport]] = {}
    for report in live:
        if known.get(report.venue_id):
            groups.setdefault((report.venue_id, report.leaf_off), []).append(report)
    result: dict[str, list[SunCorrection]] = {}
    for venue_id, leaf_off in sorted(groups):
        caps = _bin_caps(groups[(venue_id, leaf_off)], shade=kind == "shade")
        for start, end, cap in _runs(caps):
            result.setdefault(venue_id, []).append(
                SunCorrection(leaf_off=leaf_off, from_=start, to=end, altitude=cap)
            )
    return result

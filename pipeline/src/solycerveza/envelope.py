"""Horizon envelopes across a terrace (``docs/data-contract.md``, "Horizon envelope").

A terrace is several metres across (usually 5 to 10 tables in one or two rows), and a pin is
rarely placed to better than a few metres, so a single horizon from the pin can say shade where
half the tables are in sun. The envelope samples ground-level points across the terrace and
keeps, per azimuth bin, the lowest obstacle over them: when the sun clears it, some table is in
sun, and the app shows the terrace in sun.

Points are the pin plus the centre of every cell of the surface model's grid (``SampleGrid``,
2 m cells) within ``SAMPLE_RADIUS_M`` of it, other than the pin's own cell: about 37 points,
listed in the grid's row order (from the north on a north-up grid), west to east (#524; it was a
3 m circle). Taking the raster's own cells, rather than a pattern laid on the pin, keeps the
answer steadier as the pin moves: a small move changes only cells at the edge (#524: a 2 m
move changes the day's sun by a median 30 to 38 min, against 42 to 60 with the 3 m circle).

A point counts only on open ground: the surface model at most ``MAX_GROUND_HEIGHT_M`` above the
terrain there (not under a canopy, a crown or on a roof), outside every closed OSM structure
outline, and off every OSM carriageway (``solycerveza.roads``): tables stand on the pavement, and
the sun on the road beside a tree-lined terrace is not the terrace's.

The file stores the envelope as a 360-character string, one character per bin, in whole degrees
(``pack_low``): a string parses far faster than 360 numbers. It rounds down, so rounding can only
add sun, by under 1° (one 5-minute step of the sun's motion at most).
"""

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from functools import cache

from affine import Affine
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import Point, Polygon

from solycerveza.leafoff import Outline

SAMPLE_RADIUS_M = 7.0
# Parked cars, hedges and counters stand up to 2 m; tree crowns start above that (trees.py: 2.5
# m). The same threshold as the build's "pin on a roof or under a canopy" warning.
MAX_GROUND_HEIGHT_M = 2.0

# Whole degrees 0-90 as one character each: the 91 printable ASCII characters from "#" (35) to
# "~" (126) without the backslash, so a packed string needs no escaping in JSON.
PACK_ALPHABET = "".join(chr(c) for c in range(35, 127) if c != 92)
PACKED_PATTERN = r"^[#-\[\]-~]{360}$"

LatLonPair = tuple[float, float]


@dataclass(frozen=True)
class SampleGrid:
    """The surface model's grid: its affine transform and its projected metric CRS."""

    transform: Affine
    crs: str


@cache
def _transformers(crs: str) -> tuple[Transformer, Transformer]:
    return (
        Transformer.from_crs("EPSG:4326", crs, always_xy=True),
        Transformer.from_crs(crs, "EPSG:4326", always_xy=True),
    )


def sample_points(
    lat: float, lon: float, grid: SampleGrid, *, radius_m: float = SAMPLE_RADIUS_M
) -> list[LatLonPair]:
    """The pin, then the centres of ``grid``'s cells within ``radius_m`` of it but its own.

    Cells come in the grid's row order, then column order (north to south, west to east on a
    north-up grid).
    """
    to_grid, to_wgs84 = _transformers(grid.crs)
    x, y = to_grid.transform(lon, lat)
    inverse = ~grid.transform
    col0, row0 = inverse @ (x, y)
    own = (math.floor(col0), math.floor(row0))
    reach = math.ceil(radius_m / min(abs(grid.transform.a), abs(grid.transform.e))) + 1
    points = [(lat, lon)]
    for row in range(own[1] - reach, own[1] + reach + 1):
        for col in range(own[0] - reach, own[0] + reach + 1):
            cx, cy = grid.transform @ (col + 0.5, row + 0.5)
            if (col, row) == own or math.hypot(cx - x, cy - y) > radius_m:
                continue
            cell_lon, cell_lat = to_wgs84.transform(cx, cy)
            points.append((cell_lat, cell_lon))
    return points


class Structures:
    """Closed OSM structure outlines, for a fast "is this point inside a building?"."""

    def __init__(self, outlines: Iterable[Outline]) -> None:
        self._polygons = [Polygon(o.points) for o in outlines if o.closed]
        self._polygons = [p for p in self._polygons if p.is_valid and not p.is_empty]
        self._tree = STRtree(self._polygons)

    def contains(self, lat: float, lon: float) -> bool:
        # `query` tests `point.within(polygon)` against every indexed polygon.
        return len(self._tree.query(Point(lon, lat), predicate="within")) > 0


def ground_points(
    points: Sequence[LatLonPair],
    height_for: Callable[[float, float], float | None],
    inside_structure: Callable[[float, float], bool],
    on_road: Callable[[float, float], bool],
) -> list[LatLonPair]:
    """The points on open ground: low enough above the terrain, outside every structure and off
    every carriageway."""
    kept: list[LatLonPair] = []
    for lat, lon in points:
        height = height_for(lat, lon)
        if height is None or height > MAX_GROUND_HEIGHT_M:
            continue
        if inside_structure(lat, lon) or on_road(lat, lon):
            continue
        kept.append((lat, lon))
    return kept


def terrace_points(
    lat: float,
    lon: float,
    grid: SampleGrid,
    height_for: Callable[[float, float], float | None],
    inside_structure: Callable[[float, float], bool],
    on_road: Callable[[float, float], bool],
) -> list[LatLonPair]:
    """The ground points across a terrace (``sample_points`` on open ground); may be empty."""
    return ground_points(sample_points(lat, lon, grid), height_for, inside_structure, on_road)


def lowest(horizons: Sequence[Sequence[int]]) -> list[int]:
    """Per-bin lowest obstacle over several horizon profiles."""
    if not horizons:
        raise ValueError("an envelope needs at least one horizon")
    low = [min(values) for values in zip(*horizons, strict=True)]
    return low


def pack_low(tenths: Sequence[int]) -> str:
    """A low envelope in tenths of a degree as a packed string, rounded down to whole degrees."""
    return "".join(PACK_ALPHABET[value // 10] for value in tenths)


def unpack(packed: str) -> list[int]:
    """A packed envelope back to whole degrees per bin."""
    return [PACK_ALPHABET.index(char) for char in packed]

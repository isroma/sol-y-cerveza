"""Horizon envelopes across a terrace (``docs/data-contract.md``, "Horizon envelope").

A terrace is several metres across, and a pin is rarely placed to better than a few metres, so a
single horizon from the pin can say shade where half the tables are in sun. The envelope samples
ground-level points around the pin and keeps, per azimuth bin, the lowest obstacle over them:
when the sun clears it, some part of the terrace is in sun, and the app shows the terrace in sun.

Points are the pin plus ``SAMPLE_COUNT`` points evenly spaced on a circle of
``SAMPLE_RADIUS_M`` around it, the first due north, then clockwise. A point counts only on the
ground: the surface model at most ``MAX_GROUND_HEIGHT_M`` above the terrain there (not under a
canopy, a crown or on a roof), and outside every closed OSM structure outline.

When that leaves no ground point but the pin (a pin and its 3 m circle all under one canopy or
crown, or inside a building), ``terrace_points`` falls back to wider circles: ``FALLBACK_COUNT``
points at each of ``FALLBACK_RADII_M``, kept only if at least ``FALLBACK_MIN_POINTS`` are on the
ground, so a single far point never stands for the whole terrace.

The file stores the envelope as a 360-character string, one character per bin, in whole degrees
(``pack_low``): a string parses far faster than 360 numbers. It rounds down, so rounding can only
add sun, by under 1° (one 5-minute step of the sun's motion at most).
"""

import math
from collections.abc import Callable, Iterable, Sequence

from shapely import STRtree
from shapely.geometry import Point, Polygon

from solycerveza.leafoff import Outline

SAMPLE_RADIUS_M = 3.0
SAMPLE_COUNT = 8
MAX_GROUND_HEIGHT_M = 1.0
FALLBACK_RADII_M = (4.0, 5.0)
FALLBACK_COUNT = 12
FALLBACK_MIN_POINTS = 2

# Metres per degree of latitude; good to 0.5 % at Badajoz, which is far below a pin's error.
_M_PER_DEG_LAT = 111_320.0

# Whole degrees 0-90 as one character each: the 91 printable ASCII characters from "#" (35) to
# "~" (126) without the backslash, so a packed string needs no escaping in JSON.
PACK_ALPHABET = "".join(chr(c) for c in range(35, 127) if c != 92)
PACKED_PATTERN = r"^[#-\[\]-~]{360}$"

LatLonPair = tuple[float, float]


def sample_points(
    lat: float, lon: float, *, radius_m: float = SAMPLE_RADIUS_M, count: int = SAMPLE_COUNT
) -> list[LatLonPair]:
    """The pin, then ``count`` points on a circle of ``radius_m`` round it, from north clockwise."""
    points = [(lat, lon)]
    m_per_deg_lon = _M_PER_DEG_LAT * math.cos(math.radians(lat))
    for k in range(count):
        bearing = 2 * math.pi * k / count
        points.append(
            (
                lat + radius_m * math.cos(bearing) / _M_PER_DEG_LAT,
                lon + radius_m * math.sin(bearing) / m_per_deg_lon,
            )
        )
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
) -> list[LatLonPair]:
    """The points on open ground: low enough above the terrain and outside every structure."""
    kept: list[LatLonPair] = []
    for lat, lon in points:
        height = height_for(lat, lon)
        if height is None or height > MAX_GROUND_HEIGHT_M or inside_structure(lat, lon):
            continue
        kept.append((lat, lon))
    return kept


def terrace_points(
    lat: float,
    lon: float,
    height_for: Callable[[float, float], float | None],
    inside_structure: Callable[[float, float], bool],
) -> list[LatLonPair]:
    """The ground points across a terrace: the pin and its circle, or the wider fallback circles.

    The fallback applies only when the pin and its circle give no ground point but the pin.
    """
    points = ground_points(sample_points(lat, lon), height_for, inside_structure)
    if any(point != (lat, lon) for point in points):
        return points
    wider = [(lat, lon)]
    for radius in FALLBACK_RADII_M:
        wider += sample_points(lat, lon, radius_m=radius, count=FALLBACK_COUNT)[1:]
    fallback = ground_points(wider, height_for, inside_structure)
    return fallback if len(fallback) >= FALLBACK_MIN_POINTS else points


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

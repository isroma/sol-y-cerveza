"""Horizon envelopes across a terrace (``docs/data-contract.md``, "Horizon envelope").

A terrace is several metres across, and a pin is rarely placed to better than a few metres, so a
single horizon from the pin can say sun where half the tables are in shade. The envelope samples
ground-level points around the pin and keeps, per azimuth bin, the lowest and the highest
obstacle over them: the sun clears every point above the high envelope, no point at or below the
low one, and in between the terrace is partly in sun.

Points are the pin plus ``SAMPLE_COUNT`` points evenly spaced on a circle of
``SAMPLE_RADIUS_M`` around it, the first due north, then clockwise. A point counts only on the
ground: the surface model at most ``MAX_GROUND_HEIGHT_M`` above the terrain there (not under a
canopy, a crown or on a roof), and outside every closed OSM structure outline.
"""

import math
from collections.abc import Callable, Iterable, Sequence

from shapely import STRtree
from shapely.geometry import Point, Polygon

from solycerveza.leafoff import Outline

SAMPLE_RADIUS_M = 3.0
SAMPLE_COUNT = 8
MAX_GROUND_HEIGHT_M = 1.0

# Metres per degree of latitude; good to 0.5 % at Badajoz, which is far below a pin's error.
_M_PER_DEG_LAT = 111_320.0

LatLonPair = tuple[float, float]
Envelope = tuple[list[int], list[int]]


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


def envelope(horizons: Sequence[Sequence[int]]) -> Envelope:
    """Per-bin lowest and highest obstacle over several horizon profiles."""
    if not horizons:
        raise ValueError("an envelope needs at least one horizon")
    low = [min(values) for values in zip(*horizons, strict=True)]
    high = [max(values) for values in zip(*horizons, strict=True)]
    return low, high

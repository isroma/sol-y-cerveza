"""Geographic constants and helpers shared by every pipeline stage."""

import math
from dataclasses import dataclass
from typing import Protocol


class Point(Protocol):
    """Anything with a WGS84 latitude and longitude in degrees, such as `venues.LatLon`."""

    @property
    def lat(self) -> float: ...

    @property
    def lon(self) -> float: ...


@dataclass(frozen=True)
class BoundingBox:
    """WGS84 bounding box in degrees."""

    south: float
    west: float
    north: float
    east: float

    def __post_init__(self) -> None:
        if not (-90 <= self.south < self.north <= 90):
            raise ValueError(f"invalid latitudes: south={self.south}, north={self.north}")
        if not (-180 <= self.west < self.east <= 180):
            raise ValueError(f"invalid longitudes: west={self.west}, east={self.east}")

    @property
    def overpass(self) -> str:
        """Overpass QL bbox filter order: south,west,north,east."""
        return f"{self.south},{self.west},{self.north},{self.east}"


# Badajoz urban area (both banks of the Guadiana), generous margin for obstacles near the edge.
BADAJOZ_BBOX = BoundingBox(south=38.84, west=-7.04, north=38.92, east=-6.92)


def distance_m(a: Point, b: Point) -> float:
    """Metres between two points (equirectangular approximation, fine at city scale)."""
    x = math.radians(b.lon - a.lon) * math.cos(math.radians((a.lat + b.lat) / 2))
    y = math.radians(b.lat - a.lat)
    return 6_371_000 * math.hypot(x, y)

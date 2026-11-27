"""OSM carriageways, so the sun envelope never samples a terrace on the road (#524).

Tables stand on pavements, squares and pedestrian streets, not on the carriageway. Without this,
a terrace under a row of street trees would take the sun that falls on the road beside it.

A carriageway is an OSM way tagged ``highway`` with a road class (``ROAD_CLASSES``, and their
``_link`` ways), not in a tunnel, buffered to its width: the ``width`` tag in metres, else
``lanes`` times ``LANE_WIDTH_M``, else a default per class (``DEFAULT_WIDTH_M``). Pedestrian
streets, living streets, footways and squares are never carriageways. The widths are estimates:
parking lanes are not included, so a wide avenue can still be read partly as terrace.

``load_roads`` is the fetch stage (Overpass, cached in ``.cache/``); everything else is pure.
"""

import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
from pyproj import Transformer
from shapely import STRtree
from shapely.geometry import LineString, Point

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox
from solycerveza.venues import CACHE_DIR, cached_overpass

ROAD_CLASSES = (
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
    "unclassified",
    "residential",
    "service",
)
DEFAULT_WIDTH_M = {
    "motorway": 10.0,
    "trunk": 10.0,
    "primary": 8.0,
    "secondary": 7.0,
    "tertiary": 6.5,
    "unclassified": 6.0,
    "residential": 6.0,
    "service": 4.0,
}
LINK_WIDTH_M = 5.0
LANE_WIDTH_M = 3.25
# The metric CRS of the LiDAR rasters (ETRS89 / UTM 29N), so buffers are in metres.
METRIC_CRS = "EPSG:25829"

_NUMBER = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*(?:m)?\s*$")


@dataclass(frozen=True)
class Road:
    """A carriageway's centre line in WGS84 and its estimated width in metres."""

    points: tuple[tuple[float, float], ...]  # (lon, lat)
    width_m: float


def roads_query(bbox: BoundingBox) -> str:
    """Overpass QL for every road-class way in ``bbox``, with its geometry."""
    classes = "|".join(ROAD_CLASSES)
    return (
        "[out:json][timeout:300];\n"
        f'way["highway"~"^({classes})(_link)?$"]({bbox.overpass});\n'
        "out tags geom;\n"
    )


def road_width(tags: dict[str, str]) -> float | None:
    """The carriageway width of a way with these tags, or None if it is not a carriageway."""
    highway = tags.get("highway", "")
    kind = highway.removesuffix("_link")
    if kind not in ROAD_CLASSES or tags.get("tunnel", "no") not in ("no", ""):
        return None
    if (width := _NUMBER.match(tags.get("width", ""))) is not None:
        return float(width.group(1))
    if (lanes := _NUMBER.match(tags.get("lanes", ""))) is not None:
        return float(lanes.group(1)) * LANE_WIDTH_M
    return LINK_WIDTH_M if highway.endswith("_link") else DEFAULT_WIDTH_M[kind]


def parse_roads(data: dict[str, Any]) -> list[Road]:
    """The carriageways in an ``out tags geom`` response; other ways are skipped."""
    roads: list[Road] = []
    for element in data.get("elements", []):
        if element.get("type") != "way":
            continue
        width = road_width(element.get("tags", {}))
        points = tuple((float(p["lon"]), float(p["lat"])) for p in element.get("geometry", []))
        if width is not None and width > 0 and len(points) >= 2:
            roads.append(Road(points, width))
    return roads


def load_roads(
    bbox: BoundingBox = BADAJOZ_BBOX, cache_dir: Path = CACHE_DIR, *, refresh: bool = False
) -> list[Road]:
    """Carriageways in ``bbox``, from the cache or, if missing or ``refresh``, Overpass."""
    with httpx.Client(timeout=httpx.Timeout(360.0, connect=15.0)) as client:
        data = cached_overpass(
            roads_query(bbox), cache_dir, refresh=refresh, client=client, prefix="overpass_roads"
        )
    return parse_roads(data)


class Carriageways:
    """Carriageway areas (centre lines buffered by half their width), for "is this on the road?"."""

    def __init__(self, roads: Iterable[Road]) -> None:
        self._to_metric = Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)
        areas = []
        for road in roads:
            xs, ys = self._to_metric.transform(
                [p[0] for p in road.points], [p[1] for p in road.points]
            )
            line = LineString(zip(xs, ys, strict=True))
            areas.append(line.buffer(road.width_m / 2, cap_style="flat"))
        self._areas = [a for a in areas if not a.is_empty]
        self._tree = STRtree(self._areas)

    def contains(self, lat: float, lon: float) -> bool:
        x, y = self._to_metric.transform(lon, lat)
        # `query` tests `point.within(area)` against every indexed area.
        return len(self._tree.query(Point(x, y), predicate="within")) > 0

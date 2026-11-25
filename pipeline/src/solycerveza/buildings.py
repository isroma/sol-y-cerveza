"""Buildings at their LiDAR heights, for the map's 3D buildings and their shadows.

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.buildings [--out ../web/public/data/buildings.json]

OSM has almost no building heights in Badajoz, so the basemap draws nearly every building at
its 5 m default, and the GPU shadows (``web/src/map/prismShadows.ts``) are cast from what the
map draws, so it needs real heights. This draws the OSM footprints (``building=*``, from the
Overpass structures cache ``leafoff.load_structures`` uses; not ``roof``, which is a canopy) at
the 75th percentile of the surface height inside each footprint, 1 m in from its edge: closer
than the median to the rim that casts the shadow, since courtyards and terraces pull the median
down.

Where the LiDAR finds less than ``MIN_LIDAR_M`` (the building is newer than the 2018-19
flight, or the footprint is off), the height is ``building:levels`` x ``LEVEL_M``, or else
``DEFAULT_M``. ``--sources`` writes each building's height and its source for review.

One height per footprint flattens a tall part into the rest: the cathedral's 36 m tower became
a 15 m block. So inside each LiDAR-measured footprint, connected areas of at least
``PART_MIN_M2`` that stand ``PART_RISE_M`` or more above the building's height are drawn as their
own blocks at their own height (``tall_parts``). A part traced from the 2 m grid has
stair-stepped edges, so one that fills at least ``STRAIGHTEN_FILL`` of its minimum rotated
rectangle becomes that rectangle (``straighten``), except the round domes in ``KEEP_SHAPE``;
parts that are tree canopy (``CANOPY_PARTS``) are dropped.
The cathedral's tower (``CRENELLATED``) gets battlements on top (``crenellate``), and the old
town's landmarks are modelled by hand (``landmarks.py``).

Touching buildings whose heights are within ``DISSOLVE_M`` of each other are merged, and the
outlines are simplified by ``SIMPLIFY_M``, to keep the file small. Output: the compact format of
``trees.encode`` (base 0, except battlements and landmarks), decoded by
``web/src/map/extrusionCodec.ts``.
"""

import argparse
import csv
import json
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import numpy.typing as npt
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import geometry_mask, rasterize, shapes
from rasterio.windows import Window, from_bounds
from rasterio.windows import transform as window_transform
from shapely.geometry import LineString, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize, substring, unary_union

from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.leafoff import structures_query
from solycerveza.obstacles import Grid
from solycerveza.surface_corrections import areas, load_corrections
from solycerveza.trees import encode
from solycerveza.venues import CACHE_DIR, cached_overpass

PERCENTILE = 75
INSET_M = 1.0  # cells this far inside the outline only; OSM edges are often 1 m off
MIN_LIDAR_M = 2.0
LEVEL_M = 3.0
DEFAULT_M = 3.0
MIN_AREA_M2 = 4.0
DISSOLVE_M = 1.5
TOUCH_M = 0.3
SIMPLIFY_M = 0.5
HEIGHT_STEP_M = 0.5
PART_RISE_M = 4.0  # how much higher than its building a part must stand
PART_MIN_M2 = 16.0  # four 2 m cells: a tower or a dome, not a chimney or an antenna
STRAIGHTEN_FILL = 0.7  # a disc fills 0.79 of its square: round parts must be listed below
# Round domes, which stay as traced. Every straightened part was checked against the PNOA
# aerial photos (2026-11-25, #434); these four are the ones a rectangle got wrong.
KEEP_SHAPE = frozenset(
    {
        "way/569684034#part",
        "way/570762638#part",
        "relation/9340606#part",
        "way/568389126#part",
    }
)
# Tall parts that are tree canopy over a low building, not part of it (PNOA photos, #440).
CANOPY_PARTS = frozenset({"way/631575056#part", "way/301780606#part"})
CRENELLATED = frozenset({"relation/9755446#part"})  # the cathedral's tower
MERLON_M = 1.2  # side of each merlon
MERLON_EVERY_M = 2.4
MERLON_HEIGHT_M = 1.8
MERLON_SINK_M = 1.0  # the walls stop this far below the LiDAR height; the merlons rise above it
OUT_PATH = Path("../web/public/data/buildings.json")

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True)
class Building:
    """An OSM building footprint in the grid CRS."""

    osm_id: str
    footprint: Polygon
    levels: float | None


@dataclass(frozen=True)
class Measured:
    building: Building
    height: float
    source: str  # "lidar", "levels", "default" or "lidar-part"


def parse_levels(value: str | None) -> float | None:
    try:
        levels = float(value) if value is not None else None
    except ValueError:
        return None
    return levels if levels is not None and 0 < levels < 60 else None


def footprints(data: dict[str, Any], to_grid: Transformer) -> list[Building]:
    """Building ways and multipolygon relations of an ``out geom`` response, in the grid CRS."""

    def line(geometry: Iterable[dict[str, Any]]) -> list[tuple[float, float]]:
        points = [(float(p["lon"]), float(p["lat"])) for p in geometry if "lat" in p]
        xs, ys = to_grid.transform([p[0] for p in points], [p[1] for p in points])
        return list(zip(xs, ys, strict=True))

    out: list[Building] = []
    for element in data.get("elements", []):
        tags = element.get("tags", {})
        if "building" not in tags or tags["building"] == "roof":
            continue
        geom: BaseGeometry
        if element.get("type") == "way":
            points = line(element.get("geometry", []))
            if len(points) < 4 or points[0] != points[-1]:
                continue
            geom = shapely.make_valid(Polygon(points))
        elif element.get("type") == "relation":
            rings: dict[str, list[LineString]] = {"outer": [], "inner": []}
            for member in element.get("members", []):
                points = line(member.get("geometry", []))
                if member.get("role") in rings and len(points) >= 2:
                    rings[member["role"]].append(LineString(points))
            geom = unary_union(list(polygonize(rings["outer"])))
            if rings["inner"]:
                geom = geom.difference(unary_union(list(polygonize(rings["inner"]))))
        else:
            continue
        osm_id = f"{element['type']}/{element['id']}"
        for part in polygons(geom):
            if part.area >= MIN_AREA_M2:
                out.append(Building(osm_id, part, parse_levels(tags.get("building:levels"))))
    return out


def polygons(geom: BaseGeometry) -> list[Polygon]:
    if isinstance(geom, Polygon):
        return [geom] if not geom.is_empty else []
    if isinstance(geom, MultiPolygon):
        return list(geom.geoms)
    return [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]


def measure(buildings: Sequence[Building], heights: FloatArray, grid: Grid) -> list[Measured]:
    """Each building's height from the cells inside it (``INSET_M`` in, or all if too few)."""
    shape = (grid.height, grid.width)

    def cells_per_building(geoms: Iterable[tuple[BaseGeometry, int]]) -> list[FloatArray]:
        labels = rasterize(
            ((g, i) for g, i in geoms if not g.is_empty),
            out_shape=shape,
            transform=grid.transform,
            dtype="int32",
        ).ravel()
        order = np.argsort(labels, kind="stable")
        values = heights.ravel()[order]
        starts = np.searchsorted(labels[order], np.arange(1, len(buildings) + 2))
        return [values[starts[i] : starts[i + 1]] for i in range(len(buildings))]

    inside = cells_per_building(
        (b.footprint.buffer(-INSET_M), i + 1) for i, b in enumerate(buildings)
    )
    whole = cells_per_building((b.footprint, i + 1) for i, b in enumerate(buildings))
    out: list[Measured] = []
    for building, inner, every in zip(buildings, inside, whole, strict=True):
        cells = inner[np.isfinite(inner)]
        if len(cells) < 3:
            cells = every[np.isfinite(every)]
        lidar = float(np.percentile(cells, PERCENTILE)) if len(cells) else 0.0
        if lidar >= MIN_LIDAR_M:
            out.append(Measured(building, lidar, "lidar"))
        elif building.levels is not None:
            out.append(Measured(building, building.levels * LEVEL_M, "levels"))
        else:
            out.append(Measured(building, DEFAULT_M, "default"))
    return out


def tall_parts(measured: Sequence[Measured], heights: FloatArray, grid: Grid) -> list[Measured]:
    """The parts of each LiDAR-measured building that stand ``PART_RISE_M`` above its height:
    connected cells inside the footprint (``INSET_M`` in), at least ``PART_MIN_M2``, each at the
    ``PERCENTILE`` of its own cells."""
    out: list[Measured] = []
    cell_area = abs(grid.transform.a * grid.transform.e)
    for m in measured:
        if m.source != "lidar":
            continue
        inner = m.building.footprint.buffer(-INSET_M)
        if inner.is_empty or inner.area < PART_MIN_M2:
            continue
        window = (
            from_bounds(*inner.bounds, transform=grid.transform).round_offsets().round_lengths()
        )
        row, col = int(window.row_off), int(window.col_off)
        rows, cols = int(window.height) + 1, int(window.width) + 1
        if row < 0 or col < 0 or rows <= 0 or cols <= 0:
            continue
        block = heights[row : row + rows, col : col + cols]
        if block.size == 0:
            continue
        transform = window_transform(Window(col, row, cols, rows), grid.transform)
        inside = geometry_mask([inner], out_shape=block.shape, transform=transform, invert=True)
        tall = inside & np.isfinite(block) & (block >= m.height + PART_RISE_M)
        if tall.sum() * cell_area < PART_MIN_M2:
            continue
        for geom, _ in shapes(tall.astype("uint8"), mask=tall, transform=transform):
            part = shapely.geometry.shape(geom).intersection(inner)
            for piece in polygons(part):
                if piece.area < PART_MIN_M2:
                    continue
                cells = block[
                    geometry_mask([piece], out_shape=block.shape, transform=transform, invert=True)
                    & tall
                ]
                if len(cells) == 0:
                    continue
                height = float(np.percentile(cells, PERCENTILE))
                part_building = Building(f"{m.building.osm_id}#part", piece, None)
                out.append(Measured(part_building, height, "lidar-part"))
    return out


def drop_canopy(parts: Sequence[Measured]) -> list[Measured]:
    """``parts`` without the ``CANOPY_PARTS``, which must all be among them."""
    ids = {p.building.osm_id for p in parts}
    if missing := sorted(CANOPY_PARTS - ids):
        raise ValueError(f"CANOPY_PARTS not found: {missing}")
    return [p for p in parts if p.building.osm_id not in CANOPY_PARTS]


def straighten(parts: Sequence[Measured]) -> list[Measured]:
    """Each part as its minimum rotated rectangle when it fills at least ``STRAIGHTEN_FILL`` of
    it, except those in ``KEEP_SHAPE``, which must all be among ``parts``."""
    ids = {p.building.osm_id for p in parts}
    if missing := sorted(KEEP_SHAPE - ids):
        raise ValueError(f"KEEP_SHAPE parts not found: {missing}")
    out: list[Measured] = []
    for p in parts:
        footprint = p.building.footprint
        rectangle = footprint.minimum_rotated_rectangle
        if (
            p.building.osm_id not in KEEP_SHAPE
            and isinstance(rectangle, Polygon)
            and footprint.area >= STRAIGHTEN_FILL * rectangle.area
        ):
            p = Measured(Building(p.building.osm_id, rectangle, None), p.height, p.source)
        out.append(p)
    return out


def crenellate(
    parts: Sequence[Measured],
) -> tuple[list[Measured], list[tuple[float, float, Polygon]]]:
    """``parts`` with each ``CRENELLATED`` one sunk ``MERLON_SINK_M``, and its merlons as bands:
    squares of ``MERLON_M`` about every ``MERLON_EVERY_M`` along its outline. Every
    ``CRENELLATED`` id must be among ``parts``."""
    ids = {p.building.osm_id for p in parts}
    if missing := sorted(CRENELLATED - ids):
        raise ValueError(f"CRENELLATED parts not found: {missing}")
    out: list[Measured] = []
    merlons: list[tuple[float, float, Polygon]] = []
    for p in parts:
        if p.building.osm_id not in CRENELLATED:
            out.append(p)
            continue
        # On dissolve's height steps, so the merlons sit exactly on the walls.
        top = round((p.height - MERLON_SINK_M) / HEIGHT_STEP_M) * HEIGHT_STEP_M
        out.append(Measured(p.building, top, p.source))
        half = MERLON_M / 2
        # Centres half a merlon in, so each stands on the wall, flush with its face.
        ring = p.building.footprint.buffer(-half, join_style="mitre")
        corners = list(ring.exterior.coords) if isinstance(ring, Polygon) else []
        for a, b in pairwise(corners):
            edge = LineString([a, b])
            count = max(2, int(edge.length // MERLON_EVERY_M))
            for i in range(count):
                # A square turned with the wall: a merlon-long stretch of it, widened.
                middle = (i + 0.5) / count * edge.length
                stretch = substring(edge, middle - half, middle + half)
                merlon = stretch.buffer(half, cap_style="flat", join_style="mitre")
                if isinstance(merlon, Polygon):
                    merlons.append((top, top + MERLON_HEIGHT_M, merlon))
    return out, merlons


def dissolve(measured: Sequence[Measured]) -> list[tuple[float, float, Polygon]]:
    """(0, height, outline): touching buildings merged while their heights stay within
    ``DISSOLVE_M``, each group at its area-weighted height, outlines simplified."""
    geoms = [m.building.footprint for m in measured]
    tree = shapely.STRtree(geoms)
    left, right = tree.query([g.buffer(TOUCH_M) for g in geoms], predicate="intersects")
    pairs = sorted(
        (
            (abs(measured[a].height - measured[b].height), a, b)
            for a, b in zip(left, right, strict=True)
            if a < b
        ),
    )
    parent = list(range(len(measured)))
    low = [m.height for m in measured]
    high = list(low)

    def root(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for _, a, b in pairs:
        ra, rb = root(int(a)), root(int(b))
        if ra == rb or max(high[ra], high[rb]) - min(low[ra], low[rb]) > DISSOLVE_M:
            continue
        parent[rb] = ra
        low[ra], high[ra] = min(low[ra], low[rb]), max(high[ra], high[rb])
    groups: dict[int, list[int]] = {}
    for i in range(len(measured)):
        groups.setdefault(root(i), []).append(i)
    out: list[tuple[float, float, Polygon]] = []
    for members in groups.values():
        areas = np.array([geoms[i].area for i in members])
        height = float(np.average([measured[i].height for i in members], weights=areas))
        height = round(height / HEIGHT_STEP_M) * HEIGHT_STEP_M
        merged = unary_union([geoms[i].buffer(TOUCH_M) for i in members]).buffer(-TOUCH_M)
        for part in polygons(merged.simplify(SIMPLIFY_M)):
            if part.area >= MIN_AREA_M2:
                out.append((0.0, height, part))
    return out


def load_osm(cache_dir: Path) -> dict[str, Any]:
    """The Overpass structures response (tags and geometry), cached as for leafoff."""
    with httpx.Client(timeout=httpx.Timeout(360.0, connect=15.0)) as client:
        return cached_overpass(
            structures_query(BADAJOZ_BBOX), cache_dir, client=client, prefix="overpass_structures"
        )


def build(dsm_path: Path, dtm_path: Path, cache_dir: Path) -> tuple[dict[str, Any], list[Measured]]:
    with rasterio.open(dsm_path) as dsm, rasterio.open(dtm_path) as dtm:
        grid = Grid(dsm.crs.to_string(), dsm.transform, dsm.width, dsm.height)
        surface = dsm.read(1).astype(np.float64)
        terrain = dtm.read(1).astype(np.float64)
        for data, nodata in ((surface, dsm.nodata), (terrain, dtm.nodata)):
            if nodata is not None:
                data[data == nodata] = np.nan
    raw = load_osm(cache_dir)
    to_grid = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    heights = surface - terrain
    # Unmapped structures the review found (surface_corrections.py) are drawn as buildings.
    built = [
        Building(f"correction/{i}", area, None)
        for i, area in enumerate(areas(load_corrections(), "structure", grid.crs))
    ]
    measured = measure([*footprints(raw, to_grid), *built], heights, grid)
    parts, merlons = crenellate(straighten(drop_canopy(tall_parts(measured, heights, grid))))
    measured = [*measured, *parts]
    # landmarks.py builds on this module's types, so it is imported here, not at the top.
    from solycerveza import landmarks

    shapes = landmarks.load_outlines(cache_dir, to_grid)
    drawn, landmark_bands = landmarks.apply(measured, shapes, heights, grid)
    return encode([*dissolve(drawn), *merlons, *landmark_bands], grid.crs), measured


def write_sources(measured: Sequence[Measured], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.writer(file)
        writer.writerow(["osm_id", "height_m", "source"])
        for m in sorted(measured, key=lambda m: m.building.osm_id):
            writer.writerow([m.building.osm_id, f"{m.height:.1f}", m.source])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    parser.add_argument("--cache", type=Path, default=CACHE_DIR)
    parser.add_argument("--sources", type=Path, help="CSV of each building's height and source")
    args = parser.parse_args(argv)
    data, measured = build(
        args.cache / "badajoz_dsm.tif", args.cache / "badajoz_dtm.tif", args.cache
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(data, separators=(",", ":")) + "\n", encoding="utf-8")
    if args.sources:
        write_sources(measured, args.sources)
    count = sum(len(polygons) for _, _, polygons in data["g"])
    by_source = {
        s: sum(m.source == s for m in measured)
        for s in ("lidar", "levels", "default", "lidar-part")
    }
    print(f"wrote {count} outlines ({len(measured)} buildings, {by_source}) to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

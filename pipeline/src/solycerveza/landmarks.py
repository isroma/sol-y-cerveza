"""The old town's landmarks, modelled by hand on top of the LiDAR buildings (``buildings.py``).

One block per footprint can't show what makes them recognisable, and the Alcazaba's walls aren't
OSM buildings at all (a ``barrier=city_wall`` line), so the map didn't draw them. From their OSM
outlines (fetched by id, ``LANDMARK_WAYS``) and the LiDAR heights:

- The Alcazaba's walls (``alcazaba``): ``WALL_T`` thick inside the outline, at the LiDAR height
  every ``WALL_STEP_M`` (smoothed, within ``WALL_MIN_M``..``WALL_MAX_M``), with battlements; its
  towers are where the outline juts out, ``TOWER_RISE_M`` above the wall. Wall and towers are left
  out where taller houses already stand on them.
- The Torre de Espantaperros (``espantaperros``): its octagonal body, a narrower crown on top
  (the Mudéjar body added in the 16th century) and battlements on both.
- The Puerta de Palmas (``puerta_de_palmas``): battlements on its round towers.
- Plaza Alta (``arcades``): the houses on its two long sides stand on pillars, ``ARCADE_H`` high
  and ``ARCADE_D`` deep, over the arcades (soportales).

All of these are bands with their own base, kept out of ``buildings.dissolve``. They only change
what the map draws: terraces' sun comes from the LiDAR horizons, not from ``buildings.json``.
"""

from collections.abc import Sequence
from itertools import pairwise
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import numpy.typing as npt
import shapely
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.windows import Window, from_bounds
from rasterio.windows import transform as window_transform
from shapely.geometry import LineString, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import substring, unary_union

from solycerveza.buildings import HEIGHT_STEP_M, Measured, polygons
from solycerveza.obstacles import Grid
from solycerveza.venues import cached_overpass

FloatArray = npt.NDArray[np.float64]
Band = tuple[float, float, Polygon]

ALCAZABA = 96592131  # "Recinto Monumental de la Alcazaba", barrier=city_wall
ESPANTAPERROS = 584482930
PUERTA_DE_PALMAS = 96592196
PLAZA_ALTA = 96634558
LANDMARK_WAYS = (ALCAZABA, ESPANTAPERROS, PUERTA_DE_PALMAS, PLAZA_ALTA)

MERLON_M = 1.0
MERLON_EVERY_M = 2.2
MERLON_HEIGHT_M = 1.4
WALL_T = 2.6
WALL_STEP_M = 5.0
WALL_MIN_M = 5.0
WALL_MAX_M = 13.0
TOWER_RISE_M = 3.0
TOWER_MIN_M2 = 8.0  # smaller bumps are kinks in the outline
TOWER_MAX_M2 = 90.0  # larger ones are houses the outline wraps round
CROWN_INSET_M = 2.0
CROWN_M = 5.0  # the crown's height; it ends 1 m under the LiDAR's highest point
ARCADE_H = 3.6
ARCADE_D = 4.0
PILLAR_M = 0.7
PILLAR_EVERY_M = 3.2


def landmarks_query() -> str:
    ids = ",".join(str(i) for i in LANDMARK_WAYS)
    return f"[out:json][timeout:60];\nway(id:{ids});\nout geom;\n"


def outlines(data: dict[str, Any], to_grid: Transformer) -> dict[int, Polygon]:
    """Each landmark's closed way as a polygon in the grid CRS; all of them must be there."""
    out: dict[int, Polygon] = {}
    for element in data.get("elements", []):
        if element.get("type") != "way" or element.get("id") not in LANDMARK_WAYS:
            continue
        points = [(float(p["lon"]), float(p["lat"])) for p in element.get("geometry", [])]
        if len(points) < 4 or points[0] != points[-1]:
            continue
        xs, ys = to_grid.transform([p[0] for p in points], [p[1] for p in points])
        valid = polygons(shapely.make_valid(Polygon(zip(xs, ys, strict=True))))
        if valid:
            out[int(element["id"])] = max(valid, key=lambda p: p.area)
    if missing := sorted(set(LANDMARK_WAYS) - set(out)):
        raise ValueError(f"landmark ways not found or not closed: {missing}")
    return out


def load_outlines(cache_dir: Path, to_grid: Transformer) -> dict[int, Polygon]:
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        data = cached_overpass(
            landmarks_query(), cache_dir, client=client, prefix="overpass_landmarks"
        )
    return outlines(data, to_grid)


def percentile_in(geom: BaseGeometry, heights: FloatArray, grid: Grid, q: float) -> float:
    """The ``q`` percentile of the heights inside ``geom`` (0 if it covers no cell)."""
    window = from_bounds(*geom.bounds, transform=grid.transform).round_offsets().round_lengths()
    row, col = max(0, int(window.row_off)), max(0, int(window.col_off))
    block = heights[row : row + int(window.height) + 1, col : col + int(window.width) + 1]
    if block.size == 0:
        return 0.0
    transform = window_transform(Window(col, row, block.shape[1], block.shape[0]), grid.transform)
    inside = geometry_mask([geom], out_shape=block.shape, transform=transform, invert=True)
    cells = block[inside & np.isfinite(block)]
    return float(np.percentile(cells, q)) if len(cells) else 0.0


def merlons_along(
    line: LineString,
    base: float,
    *,
    size: float = MERLON_M,
    every: float = MERLON_EVERY_M,
    height: float = MERLON_HEIGHT_M,
) -> list[Band]:
    """Square merlons of ``size``, turned with ``line``, about every ``every`` along it."""
    count = max(2, int(line.length // every))
    half = size / 2
    out: list[Band] = []
    for i in range(count):
        middle = (i + 0.5) / count * line.length
        stretch = substring(line, middle - half, middle + half)
        merlon = stretch.buffer(half, cap_style="flat", join_style="mitre")
        if isinstance(merlon, Polygon) and not merlon.is_empty:
            out.append((base, base + height, merlon))
    return out


def ring_inside(footprint: Polygon, inset: float) -> LineString | None:
    """The outline ``inset`` in from ``footprint``'s edge, or None if nothing is left."""
    inner = footprint.buffer(-inset, join_style="mitre")
    return LineString(inner.exterior.coords) if isinstance(inner, Polygon) else None


def battlements(footprint: Polygon, top: float, **merlon: float) -> list[Band]:
    """Merlons standing on ``footprint``'s walls, at ``top``."""
    ring = ring_inside(footprint, merlon.get("size", MERLON_M) / 2)
    return merlons_along(ring, top, **merlon) if ring is not None else []


def step(height: float) -> float:
    return round(height / HEIGHT_STEP_M) * HEIGHT_STEP_M


def covered(geom: Polygon, by: Sequence[Measured], tree: shapely.STRtree, height: float) -> bool:
    """Whether buildings at least ``height`` tall cover most of ``geom``."""
    near = [by[i].building.footprint for i in tree.query(geom) if by[i].height >= height - 0.5]
    return bool(near) and geom.intersection(unary_union(near)).area > 0.4 * geom.area


def alcazaba(
    enclosure: Polygon, measured: Sequence[Measured], heights: FloatArray, grid: Grid
) -> list[Band]:
    """The walls round ``enclosure``, their towers and battlements."""
    outline = LineString(enclosure.exterior.coords)
    starts = np.arange(0.0, outline.length, WALL_STEP_M)
    raw = np.array(
        [
            percentile_in(substring(outline, d, d + WALL_STEP_M).buffer(2.0), heights, grid, 90)
            for d in starts
        ]
    )
    # A running mean over five steps (the outline is a ring, so it wraps).
    smooth = np.convolve(np.pad(raw, 2, mode="wrap"), np.ones(5) / 5, mode="valid")
    wall_h = np.clip(smooth, WALL_MIN_M, WALL_MAX_M)

    def height_at(distance: float) -> float:
        return step(float(np.interp(distance % outline.length, starts, wall_h)))

    tree = shapely.STRtree([m.building.footprint for m in measured])
    inward = "left" if enclosure.exterior.is_ccw else "right"
    out: list[Band] = []
    for d in starts:
        stretch = substring(outline, d, min(d + WALL_STEP_M, outline.length))
        if not isinstance(stretch, LineString) or stretch.length < 0.5:
            continue
        top = height_at(d + WALL_STEP_M / 2)
        piece: BaseGeometry = stretch.buffer(WALL_T, single_sided=True, join_style="mitre")
        piece = piece.intersection(enclosure)
        if piece.area < 1.0:  # the single side is the outer one for this stretch's direction
            piece = stretch.buffer(-WALL_T, single_sided=True, join_style="mitre")
            piece = piece.intersection(enclosure)
        for part in polygons(piece):
            if part.area < 1.0 or covered(part, measured, tree, top):
                continue
            out.append((0.0, top, part))
            edge = stretch.offset_curve(0.5 if inward == "left" else -0.5)
            if isinstance(edge, LineString) and edge.length > 1.5:
                out.extend(merlons_along(edge, top))
    opened = enclosure.buffer(-4.5, join_style="mitre").buffer(4.5, join_style="mitre")
    for bump in polygons(enclosure.difference(opened)):
        if not TOWER_MIN_M2 <= bump.area <= TOWER_MAX_M2:
            continue
        tower = bump.minimum_rotated_rectangle.buffer(0.8, join_style="mitre")
        if not isinstance(tower, Polygon):
            continue
        top = height_at(outline.project(bump.centroid)) + TOWER_RISE_M
        if any(
            measured[i].building.footprint.intersection(tower).area > 0.3 * tower.area
            for i in tree.query(tower)
        ):
            continue
        out.append((0.0, top, tower))
        out.extend(battlements(tower, top))
    return out


def espantaperros(footprint: Polygon, heights: FloatArray, grid: Grid) -> list[Band]:
    """The octagonal tower, a narrower crown on it, and battlements on both."""
    crown_top = step(percentile_in(footprint, heights, grid, 95) - 1.0)
    body_top = crown_top - CROWN_M
    crown = footprint.buffer(-CROWN_INSET_M, join_style="mitre")
    out: list[Band] = [(0.0, body_top, footprint)]
    out.extend(battlements(footprint, body_top, size=0.9, every=2.0, height=1.2))
    if isinstance(crown, Polygon):
        out.append((body_top, crown_top, crown))
        out.extend(battlements(crown, crown_top, size=0.8, every=1.8, height=1.1))
    return out


def arcades(plaza: Polygon, measured: Sequence[Measured]) -> tuple[list[Measured], list[Band]]:
    """``measured`` without the houses on Plaza Alta's long sides, and those houses as bands:
    their front ``ARCADE_D`` raised on pillars ``ARCADE_H`` high, the rest as it was."""
    rectangle = plaza.minimum_rotated_rectangle
    if not isinstance(rectangle, Polygon):
        return list(measured), []
    corners = list(rectangle.exterior.coords)[:4]
    sides = sorted(pairwise([*corners, corners[0]]), key=lambda ab: LineString(ab).length)
    near_long = unary_union([LineString(ab).buffer(12.0, cap_style="flat") for ab in sides[2:]])
    front = plaza.buffer(ARCADE_D, join_style="mitre").difference(plaza).intersection(near_long)
    kept: list[Measured] = []
    out: list[Band] = []
    for m in measured:
        footprint = m.building.footprint
        strip = footprint.intersection(front)
        if footprint.distance(plaza) > 2.0 or m.height < ARCADE_H + 2.0 or strip.area < 4.0:
            kept.append(m)
            continue
        top = step(m.height)
        out.extend((0.0, top, p) for p in polygons(footprint.difference(strip)) if p.area > 2.0)
        out.extend((ARCADE_H, top, p) for p in polygons(strip))
        facade = shapely.line_merge(strip.boundary.intersection(plaza.buffer(1.5)))
        for line in getattr(facade, "geoms", [facade]):
            if not isinstance(line, LineString) or line.length < 2.0:
                continue
            count = max(1, int(line.length // PILLAR_EVERY_M))
            for k in range(count + 1):
                at = line.interpolate(k / count, normalized=True)
                half = PILLAR_M / 2
                pillar = shapely.box(at.x - half, at.y - half, at.x + half, at.y + half)
                out.extend((0.0, ARCADE_H, p) for p in polygons(pillar.intersection(strip)))
    return kept, out


def apply(
    measured: Sequence[Measured],
    shapes: dict[int, Polygon],
    heights: FloatArray,
    grid: Grid,
) -> tuple[list[Measured], list[Band]]:
    """``measured`` without the buildings the landmarks replace, and the landmarks' bands."""
    replaced = {f"way/{ESPANTAPERROS}", f"way/{PUERTA_DE_PALMAS}"}
    gate = [m for m in measured if m.building.osm_id == f"way/{PUERTA_DE_PALMAS}"]
    kept = [m for m in measured if m.building.osm_id.removesuffix("#part") not in replaced]
    bands = alcazaba(shapes[ALCAZABA], kept, heights, grid)
    bands += espantaperros(shapes[ESPANTAPERROS], heights, grid)
    for m in gate:
        top = step(m.height)
        bands += [(0.0, top, m.building.footprint), *battlements(m.building.footprint, top)]
    kept, arcade_bands = arcades(shapes[PLAZA_ALTA], kept)
    return kept, [*bands, *arcade_bands]

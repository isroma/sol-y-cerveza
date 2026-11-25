"""The four bridges over the Guadiana, modelled from street to street (#444).

OSM draws them as flat roads, so the map drew nothing over the river. From their deck outlines
(OSM ``man_made=bridge``, fetched by id, ``BRIDGE_WAYS``) and the LiDAR:

- The deck (``Deck``) is flat at its height over the river (the median, over the middle 60 % of
  its length, of the deck's surface above the lowest terrain beside it) and eases down to the
  street at both ends over ``RAMP_M`` (or the bridge's own ramps), sometimes running on past
  the outline along the approach road. The map has no terrain: water and streets are both at 0.
- Puente de Palmas (16th c.): 32 granite arches, pointed piers, parapets.
- Puente de la Universidad (1960, a concrete deck-arch bridge): arches under the deck with
  spandrel columns.
- Puente de la Autonomía (1990, steel girders): twin piers, the girders deeper over them.
- Puente Real (1994, cable-stayed): slim piers and a footing on the island. Its A-shaped pylon
  and 28 cables are slanted, which extrusions can't draw, so they are a small triangle mesh
  (``bridge-mesh.json``, drawn by ``web/src/map/bridgeMesh.ts``). The mesh file also carries
  the decks' outlines, where the web hides the basemap's own bridge roads.

These only change what the map draws: terraces' sun comes from the LiDAR horizons.
"""

import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import numpy.typing as npt
import shapely
from pyproj import Transformer
from rasterio.features import geometry_mask
from rasterio.transform import xy
from rasterio.windows import Window, from_bounds
from rasterio.windows import transform as window_transform
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from solycerveza.buildings import Measured, polygons
from solycerveza.landmarks import Band
from solycerveza.obstacles import Grid
from solycerveza.venues import cached_overpass

FloatArray = npt.NDArray[np.float64]
Vec = npt.NDArray[np.float64]

PALMAS = 620989342
UNIVERSIDAD = 620989341
AUTONOMIA = 620989941
REAL = 614293376
BRIDGE_WAYS = (PALMAS, UNIVERSIDAD, AUTONOMIA, REAL)

SAMPLE_M = 4.0  # deck profile step
WINDOW = 15  # samples (60 m): the most over the lowest ground, then a running mean
RAMP_M = 90.0
DECK_WIDE_M = 12.0  # how far round a deck the basemap's bridge roads are hidden
ARCHES_PALMAS = 32
ARCHES_UNIVERSIDAD = 9
SPANS_AUTONOMIA = 6
CABLES_PER_FAN = 7  # 4 fans (2 sides x 2 planes): 28 cables
EARTH_RADIUS_M = 6378137.0


def bridges_query() -> str:
    ids = ",".join(str(i) for i in BRIDGE_WAYS)
    return f"[out:json][timeout:60];\nway(id:{ids});\nout geom;\n"


def outlines(data: dict[str, Any], to_grid: Transformer) -> dict[int, Polygon]:
    """Each bridge's deck outline in the grid CRS; all of them must be there."""
    out: dict[int, Polygon] = {}
    for element in data.get("elements", []):
        if element.get("type") != "way" or element.get("id") not in BRIDGE_WAYS:
            continue
        points = [(float(p["lon"]), float(p["lat"])) for p in element.get("geometry", [])]
        if len(points) < 4 or points[0] != points[-1]:
            continue
        xs, ys = to_grid.transform([p[0] for p in points], [p[1] for p in points])
        out[int(element["id"])] = Polygon(zip(xs, ys, strict=True))
    if missing := sorted(set(BRIDGE_WAYS) - set(out)):
        raise ValueError(f"bridge ways not found or not closed: {missing}")
    return out


def load_outlines(cache_dir: Path, to_grid: Transformer) -> dict[int, Polygon]:
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        data = cached_overpass(bridges_query(), cache_dir, client=client, prefix="overpass_bridges")
    return outlines(data, to_grid)


def percentile(geom: BaseGeometry, values: FloatArray, grid: Grid, q: float) -> float:
    """The ``q`` percentile of ``values`` inside ``geom`` (NaN if it covers no cell)."""
    window = from_bounds(*geom.bounds, transform=grid.transform).round_offsets().round_lengths()
    row, col = max(0, int(window.row_off)), max(0, int(window.col_off))
    block = values[row : row + int(window.height) + 1, col : col + int(window.width) + 1]
    if block.size == 0:
        return math.nan
    transform = window_transform(Window(col, row, block.shape[1], block.shape[0]), grid.transform)
    inside = geometry_mask([geom], out_shape=block.shape, transform=transform, invert=True)
    cells = block[inside & np.isfinite(block)]
    return float(np.percentile(cells, q)) if len(cells) else math.nan


class Deck:
    """A bridge deck along its outline's long axis: ``d`` metres from its first end."""

    def __init__(
        self,
        outline: Polygon,
        surface: FloatArray,
        terrain: FloatArray,
        grid: Grid,
        *,
        ramps: tuple[float, float] | None = None,
        extend: tuple[float, float] = (0.0, 0.0),
    ) -> None:
        """``ramps`` and ``extend`` are (west end, east end), in metres."""
        rectangle = outline.minimum_rotated_rectangle
        if not isinstance(rectangle, Polygon):
            raise ValueError("a bridge outline needs an area")
        corners = [np.array(c) for c in list(rectangle.exterior.coords)[:4]]
        sides = sorted(
            range(4), key=lambda i: float(np.linalg.norm(corners[(i + 1) % 4] - corners[i]))
        )
        long_side, short_side = sides[-1], sides[0]
        a, b = corners[long_side], corners[(long_side + 1) % 4]
        self.length = float(np.linalg.norm(b - a))
        self.width = float(np.linalg.norm(corners[(short_side + 1) % 4] - corners[short_side]))
        self.u: Vec = (b - a) / self.length
        normal: Vec = np.array([-self.u[1], self.u[0]])
        if not rectangle.contains(Point(*(a + normal * self.width / 2))):
            normal = -normal
        self.n: Vec = normal
        self.o: Vec = a + normal * self.width / 2
        self.full = self.deck_height(surface, terrain, grid)
        default = min(RAMP_M, self.length * 0.3)
        ramp_w, ramp_e = ramps or (default, default)
        ext_w, ext_e = extend
        west_first = self.o[0] < self.at(self.length)[0]  # UTM x grows eastwards
        self.ramp0, self.ramp1 = (ramp_w, ramp_e) if west_first else (ramp_e, ramp_w)
        self.ext0, self.ext1 = (ext_w, ext_e) if west_first else (ext_e, ext_w)

    def at(self, d: float, off: float = 0.0) -> Vec:
        point: Vec = self.o + self.u * d + self.n * off
        return point

    def rect(self, d0: float, d1: float, width: float, off: float = 0.0) -> Polygon:
        h = width / 2
        return Polygon(
            [
                self.at(d0, off - h),
                self.at(d1, off - h),
                self.at(d1, off + h),
                self.at(d0, off + h),
            ]
        )

    def deck_height(self, surface: FloatArray, terrain: FloatArray, grid: Grid) -> float:
        """The deck's surface over the lowest terrain beside it, every ``SAMPLE_M``; islands and
        banks beside it lift that ground, and pylons and lamps the surface, so the most within
        ``WINDOW`` samples is smoothed; the deck is flat at the middle 60 %'s median."""
        xs = np.arange(0.0, self.length + 1.0, SAMPLE_M)
        profile = []
        for d in xs:
            d0, d1 = max(0.0, d - 5), min(self.length, d + 5)
            top = percentile(self.rect(d0, d1, self.width - 2), surface, grid, 25)
            beside = np.nanmin(
                [
                    percentile(self.rect(d0, d1, 18, self.width / 2 + 12), terrain, grid, 10),
                    percentile(self.rect(d0, d1, 18, -self.width / 2 - 12), terrain, grid, 10),
                ]
            )
            profile.append(top - beside)
        values = np.array(profile, dtype=np.float64)
        middle = (xs > 40) & (xs < self.length - 40)
        typical = float(np.nanmedian(values[middle]))
        bad = ~np.isfinite(values) | (values > typical + 6)  # a pylon is not the deck
        values[bad] = np.interp(xs[bad], xs[~bad], values[~bad])
        half = WINDOW // 2
        padded = np.pad(values, half, mode="edge")
        highest = np.array([padded[k : k + WINDOW].max() for k in range(len(values))])
        smooth = np.convolve(np.pad(highest, half, mode="edge"), np.ones(WINDOW) / WINDOW, "valid")
        inner = (xs > self.length * 0.2) & (xs < self.length * 0.8)
        return max(0.0, float(np.median(smooth[inner])))

    def h(self, d: float) -> float:
        """The deck's top at ``d``: flat, easing down to 0 at each (extended) end."""
        t0 = (d + self.ext0) / self.ramp0
        t1 = (self.length + self.ext1 - d) / self.ramp1
        t = float(np.clip(min(t0, t1), 0.0, 1.0))
        return self.full * t * t * (3 - 2 * t)

    def slab(self, depth: float, parapet: float = 1.0, every: float = SAMPLE_M) -> list[Band]:
        """The deck in ``every``-metre pieces, ``depth`` thick (solid down to 0 near the ends),
        with parapets along both edges."""
        out: list[Band] = []
        for d0 in np.arange(-self.ext0, self.length + self.ext1, every):
            d1 = min(self.length + self.ext1, d0 + every)
            top = self.h((d0 + d1) / 2)
            if top < 0.1:  # at street level: the basemap's road
                continue
            out.append(
                (top - depth if top > depth + 0.8 else 0.0, top, self.rect(d0, d1, self.width))
            )
            for off in (-self.width / 2 + 0.25, self.width / 2 - 0.25):
                out.append((top, top + parapet, self.rect(d0, d1, 0.5, off)))
        return out


def palmas(deck: Deck) -> list[Band]:
    """Granite arches: pointed piers, and openings narrowing in three steps under the deck."""
    out = deck.slab(1.3)
    span = deck.length / ARCHES_PALMAS
    w = deck.width
    for k in range(1, ARCHES_PALMAS):
        d = k * span
        top = deck.h(d) - 1.3
        if top < 1.0:
            continue
        pier = Polygon(
            [
                deck.at(d - 1.8, -w / 2),
                deck.at(d, -w / 2 - 1.6),
                deck.at(d + 1.8, -w / 2),
                deck.at(d + 1.8, w / 2),
                deck.at(d, w / 2 + 1.6),
                deck.at(d - 1.8, w / 2),
            ]
        )
        out.append((0.0, top, pier))
    for k in range(ARCHES_PALMAS):
        d0, d1 = k * span + 1.8, (k + 1) * span - 1.8
        middle = (d0 + d1) / 2
        top = deck.h(middle) - 1.3
        if top < 1.5:
            continue
        rise = min(2.8, top * 0.5)
        for i, share in enumerate((0.92, 0.75, 0.5)):
            base = top - rise * (i + 1) / 3
            gap = (d1 - d0) * share
            out.append((base, top, deck.rect(d0, middle - gap / 2, w)))
            out.append((base, top, deck.rect(middle + gap / 2, d1, w)))
    return out


def universidad(deck: Deck) -> list[Band]:
    """Concrete arch ribs under the deck, columns from the ribs to the deck, and piers."""
    out = deck.slab(1.0)
    span = deck.length / ARCHES_UNIVERSIDAD
    for k in range(ARCHES_UNIVERSIDAD):
        d0, d1 = k * span, (k + 1) * span
        top = deck.h((d0 + d1) / 2) - 1.0
        if top < 2.5:
            continue

        def rib(t: float, top: float = top) -> float:
            return top * 0.15 + (top * 0.85 - 0.3) * (1 - (2 * t - 1) ** 2)

        steps = 8
        for i in range(steps):
            t0, t1 = i / steps, (i + 1) / steps
            low, high = sorted((rib(t0), rib(t1)))
            rib_top = min(high + 1.2, top)  # the crown meets the deck
            out.append((low, rib_top, deck.rect(d0 + span * t0, d0 + span * t1, deck.width - 1)))
            if i % 2 == 1 and rib_top < top - 0.5:  # columns where the rib is below the deck
                column = d0 + span * t1
                out.append((rib_top, top, deck.rect(column - 0.4, column + 0.4, deck.width - 2)))
        out.append((0.0, top * 0.15 + 0.5, deck.rect(d0 - 1.5, d0 + 1.5, deck.width + 1)))
    return out


def autonomia(deck: Deck) -> list[Band]:
    """Steel girders, deeper over the piers in three steps, on twin piers."""
    out = deck.slab(1.6)
    span = deck.length / SPANS_AUTONOMIA
    for k in range(1, SPANS_AUTONOMIA):
        d = k * span
        top = deck.h(d) - 1.6
        if top < 2.0:
            continue
        for half, depth in ((10.0, 0.8), (6.0, 1.6), (3.0, 2.4)):
            out.append((top - depth, top, deck.rect(d - half, d + half, deck.width - 1.5)))
        for off in (-deck.width / 4, deck.width / 4):
            out.append((0.0, top - 2.4, deck.rect(d - 1.2, d + 1.2, 2.2, off)))
    return out


def real(
    deck: Deck, surface: FloatArray, terrain: FloatArray, grid: Grid
) -> tuple[list[Band], dict[str, Any]]:
    """The deck on slim piers and the pylon's footing as bands; the A-shaped pylon (two legs
    from beside the deck to 72 % of its height, then a mast) and the cables (two planes a side,
    from the mast to the deck's edges) as a mesh."""
    out = deck.slab(1.8, parapet=1.1)
    zone = deck.rect(0, deck.length, deck.width + 12)
    window = from_bounds(*zone.bounds, transform=grid.transform).round_offsets().round_lengths()
    row, col = max(0, int(window.row_off)), max(0, int(window.col_off))
    block = surface[row : row + int(window.height) + 1, col : col + int(window.width) + 1]
    transform = window_transform(Window(col, row, block.shape[1], block.shape[0]), grid.transform)
    inside = geometry_mask([zone], out_shape=block.shape, transform=transform, invert=True)
    masked = np.where(inside & np.isfinite(block), block, -np.inf)
    r, c = np.unravel_index(int(np.argmax(masked)), masked.shape)
    px, py = xy(transform, int(r), int(c))
    pylon_d = LineString([deck.at(0), deck.at(deck.length)]).project(Point(px, py))
    river = percentile(deck.rect(deck.length * 0.3, deck.length * 0.7, 80), terrain, grid, 5)
    top = float(masked[r, c]) - river
    for d in np.arange(20.0, deck.length - 10, 40.0):
        if abs(d - pylon_d) >= 15 and deck.h(d) > 3:
            out.append((0.0, deck.h(d) - 1.8, deck.rect(d - 1, d + 1, deck.width * 0.4)))
    apex = top * 0.72
    foot = deck.width / 2 + 2.0
    out.append((0.0, 4.0, deck.rect(pylon_d - 3, pylon_d + 3, 2 * foot + 4)))
    mesh = Mesh(deck, pylon_d, grid)
    for side in (-1, 1):  # the legs
        mesh.beam(deck.at(pylon_d, side * foot), 0.0, deck.at(pylon_d), apex + 1.0, 2.4, 3.4)
    mesh.beam(deck.at(pylon_d), apex, deck.at(pylon_d), top, 2.6, 3.4)  # the mast
    cross = deck.h(pylon_d) - 1.8
    mesh.beam(deck.at(pylon_d, -foot * 0.62), cross, deck.at(pylon_d, foot * 0.62), cross, 1.6, 2.6)
    reach = min(pylon_d, deck.length - pylon_d, 125.0) - 6
    n = CABLES_PER_FAN - 1
    for along in (-1, 1):
        for plane in (-1, 1):
            for k in range(CABLES_PER_FAN):
                z_top = apex + 3 + (top - 6 - apex) * k / n
                far = 22 + (reach - 22) * k / n
                end = pylon_d + along * far
                anchor = deck.at(end, plane * (deck.width / 2 - 0.6))
                mesh.beam(
                    deck.at(pylon_d, plane * 0.8), z_top, anchor, deck.h(end) + 0.3, 0.35, 0.35
                )
    return out, mesh.data()


class Mesh:
    """Triangles in metres from the pylon (x east, y south, z up), as the web's frame has them."""

    def __init__(self, deck: Deck, origin_d: float, grid: Grid) -> None:
        self.to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)
        self.lon, self.lat = self.to_wgs84.transform(*deck.at(origin_d))
        self.metres = 2 * math.pi * EARTH_RADIUS_M * math.cos(math.radians(self.lat))
        self.ox, self.oy = self.mercator(self.lon, self.lat)
        self.along = self.local(deck.at(origin_d + 1), 0.0) - self.local(deck.at(origin_d), 0.0)
        self.along /= np.linalg.norm(self.along)
        self.triangles: list[float] = []

    @staticmethod
    def mercator(lon: float, lat: float) -> tuple[float, float]:
        y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
        return (lon + 180) / 360, (1 - y / math.pi) / 2

    def local(self, point: Vec, z: float) -> Vec:
        lon, lat = self.to_wgs84.transform(float(point[0]), float(point[1]))
        mx, my = self.mercator(lon, lat)
        return np.array([(mx - self.ox) * self.metres, (my - self.oy) * self.metres, z])

    def beam(self, p0: Vec, z0: float, p1: Vec, z1: float, width: float, depth: float) -> None:
        """A box from (p0, z0) to (p1, z1): ``width`` across the bridge, ``depth`` along it."""
        a0, a1 = self.local(p0, z0), self.local(p1, z1)
        axis = (a1 - a0) / np.linalg.norm(a1 - a0)
        across = np.cross(axis, self.along)
        across /= np.linalg.norm(across)
        along = np.cross(across, axis)
        w, d = across * width / 2, along * depth / 2
        c = [a0 - w - d, a0 + w - d, a0 + w + d, a0 - w + d, a1 - w - d, a1 + w - d, a1 + w + d]
        c.append(a1 - w + d)
        faces = ((0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7), (3, 2, 1, 0))
        for p, q, r, s in faces:
            for corner in (c[p], c[q], c[r], c[p], c[r], c[s]):
                self.triangles.extend(round(float(v), 2) for v in corner)

    def data(self) -> dict[str, Any]:
        return {
            "v": 1,
            "origin": [round(self.lon, 7), round(self.lat, 7)],
            "triangles": self.triangles,
        }


def apply(
    measured: Sequence[Measured],
    shapes: dict[int, Polygon],
    surface: FloatArray,
    terrain: FloatArray,
    grid: Grid,
) -> tuple[list[Measured], list[Band], dict[str, Any]]:
    """``measured`` without buildings on the decks, the bridges' bands, and the mesh file."""
    decks = {
        PALMAS: Deck(shapes[PALMAS], surface, terrain, grid),
        UNIVERSIDAD: Deck(shapes[UNIVERSIDAD], surface, terrain, grid),
        AUTONOMIA: Deck(shapes[AUTONOMIA], surface, terrain, grid),
        # The Avenida de Elvas end eases down longer, running on towards its roundabout.
        REAL: Deck(shapes[REAL], surface, terrain, grid, ramps=(170.0, 110.0), extend=(45.0, 10.0)),
    }
    kept = [
        m
        for m in measured
        if not any(
            m.building.footprint.intersection(s).area > 0.5 * m.building.footprint.area
            for s in shapes.values()
        )
    ]
    bands = [*palmas(decks[PALMAS]), *universidad(decks[UNIVERSIDAD]), *autonomia(decks[AUTONOMIA])]
    real_bands, mesh = real(decks[REAL], surface, terrain, grid)
    to_wgs84 = Transformer.from_crs(grid.crs, "EPSG:4326", always_xy=True)

    def wgs84(xy: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        return np.column_stack(to_wgs84.transform(xy[:, 0], xy[:, 1]))

    mesh["decks"] = []
    for outline in shapes.values():
        wide = shapely.transform(outline.buffer(DECK_WIDE_M, join_style="mitre"), wgs84)
        if isinstance(wide, Polygon):
            mesh["decks"].append([[[round(x, 6), round(y, 6)] for x, y in wide.exterior.coords]])
    out = [(b, t, p) for b, t, g in [*bands, *real_bands] for p in polygons(g) if t > b + 0.05]
    return kept, out, mesh

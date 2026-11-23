"""Leaf-off surface model: the DSM with deciduous tree crowns lowered to the ground (ADR-0007).

Run from ``pipeline/`` after ``python -m solycerveza.obstacles``::

    python -m solycerveza.leafoff [--year 2025] [--refresh]

It writes ``.cache/badajoz_dsm_leafoff.tif`` on the DSM's grid. ``solycerveza.build`` and
``solycerveza.probe`` compute ``horizon_winter`` from it when it exists. Inputs, both fetched once
and cached in ``.cache/``:

- OSM building footprints, walls and other structures (Overpass, ODbL). Cells within
  ``BUILDING_BUFFER_CELLS`` of one are never lowered.
- A Sentinel-2 L2A NDVI composite (Copernicus, open with attribution), read as Cloud-Optimized
  GeoTIFF windows from the public ``sentinel-cogs`` bucket on AWS: the per-pixel median NDVI of
  the clearest summer scenes (July to August) and winter scenes (January to February) of one year.

A cell is lowered to the terrain only if it is at least ``MIN_ABOVE_GROUND_M`` above it, away from
every structure, and its Sentinel-2 pixel is green in summer and loses its green in winter
(``deciduous_mask``). Anything uncertain keeps the DSM value, i.e. stays an obstacle.
"""

import argparse
import hashlib
import logging
import math
import re
import sys
import warnings
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import numpy.typing as npt
import rasterio
from affine import Affine
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.warp import reproject
from rasterio.windows import from_bounds

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox
from solycerveza.obstacles import NODATA, Grid, write_raster
from solycerveza.venues import CACHE_DIR, cached_overpass

log = logging.getLogger(__name__)

DSM_PATH = CACHE_DIR / "badajoz_dsm.tif"
DTM_PATH = CACHE_DIR / "badajoz_dtm.tif"
LEAFOFF_DSM_PATH = CACHE_DIR / "badajoz_dsm_leafoff.tif"

# Classification thresholds (ADR-0007). Starting values: check them on known terraces.
MIN_ABOVE_GROUND_M = 1.0
BUILDING_BUFFER_CELLS = 1  # 2 m on the 2 m grid: footprint misalignment, eaves
SUMMER_MIN_NDVI = 0.40
WINTER_DROP_MIN_NDVI = 0.20

# Sentinel-2: MGRS tile 29SPD covers all of BADAJOZ_BBOX.
S2_BUCKET_URL = "https://sentinel-cogs.s3.us-west-2.amazonaws.com"
S2_PREFIX = "sentinel-s2-l2a-cogs/29/S/PD"
S2_CRS = "EPSG:32629"
DEFAULT_YEAR = 2025
SUMMER_MONTHS = (7, 8)
WINTER_MONTHS = (1, 2)
MAX_SCENES_PER_SEASON = 6
MIN_CLEAR_FRACTION = 0.95
# L2A scene classification values that are a clear view of the ground: vegetation, not
# vegetated, water. Everything else (clouds, shadows, snow, saturated, no data) is masked.
CLEAR_SCL = (4, 5, 6)
S2_PIXEL_M = 10.0
SCL_PIXEL_M = 20.0
# Copernicus' required notice, in Spanish like the other attribution lines in terraces.json.
SENTINEL_ATTRIBUTION = "Contiene datos modificados de Copernicus Sentinel ({year})"

USER_AGENT = "sol-y-cerveza-pipeline/0.1 (+https://github.com/isroma/sol-y-cerveza)"

type FloatArray = npt.NDArray[np.floating[Any]]
type BoolArray = npt.NDArray[np.bool_]


# --- Classification (pure) -------------------------------------------------------------------


def deciduous_mask(summer_ndvi: FloatArray, winter_ndvi: FloatArray) -> BoolArray:
    """True where a pixel is green in summer and loses its green in winter. NaN is never true."""
    summer = np.asarray(summer_ndvi, dtype=np.float64)
    winter = np.asarray(winter_ndvi, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        result = (summer >= SUMMER_MIN_NDVI) & (summer - winter >= WINTER_DROP_MIN_NDVI)
    return np.asarray(result & np.isfinite(summer) & np.isfinite(winter))


def dilate(mask: BoolArray, cells: int) -> BoolArray:
    """Grow ``mask`` by ``cells`` in every direction, diagonals included (a square kernel)."""
    grown = np.asarray(mask, dtype=bool).copy()
    for _ in range(cells):
        padded = np.pad(grown, 1, constant_values=False)
        height, width = grown.shape
        grown = np.zeros_like(grown)
        for dy in (0, 1, 2):
            for dx in (0, 1, 2):
                grown |= padded[dy : dy + height, dx : dx + width]
    return grown


def leaf_off_surface(
    dsm: FloatArray,
    dtm: FloatArray,
    structures: BoolArray,
    deciduous: BoolArray,
    *,
    nodata: float | None = NODATA,
) -> tuple[npt.NDArray[np.float32], BoolArray]:
    """The DSM with deciduous crowns lowered to the terrain, and the mask of lowered cells.

    Args:
        dsm: Surface model, metres.
        dtm: Terrain model on the same grid, metres.
        structures: True on building footprints, walls and other structures. These cells and
            their neighbours within ``BUILDING_BUFFER_CELLS`` are never lowered.
        deciduous: True where Sentinel-2 sees a deciduous canopy (``deciduous_mask``), resampled
            to the same grid.
        nodata: Nodata value of both rasters; such cells (and NaN) are never lowered.
    """
    shapes = {np.shape(dsm), np.shape(dtm), np.shape(structures), np.shape(deciduous)}
    if len(shapes) != 1:
        raise ValueError(f"all inputs must share one grid, got shapes {sorted(shapes)}")
    surface = np.asarray(dsm, dtype=np.float64)
    ground = np.asarray(dtm, dtype=np.float64)
    valid = np.isfinite(surface) & np.isfinite(ground)
    if nodata is not None:
        valid &= (surface != nodata) & (ground != nodata)
    with np.errstate(invalid="ignore"):
        above = surface - ground >= MIN_ABOVE_GROUND_M
    protected = dilate(structures, BUILDING_BUFFER_CELLS)
    lowered = valid & above & np.asarray(deciduous, dtype=bool) & ~protected
    result = np.where(lowered, ground, surface).astype(np.float32)
    return result, np.asarray(lowered)


# --- Structures from OSM ---------------------------------------------------------------------

# Polygons and lines that are built, not grown. Areas such as castles and walls protect the
# trees inside them too, which errs towards shade.
_STRUCTURE_FILTERS = (
    '["building"]',
    '["building:part"]',
    '["man_made"]',
    '["barrier"~"^(wall|city_wall|retaining_wall)$"]',
    '["historic"~"^(city_walls|castle|fort|tower|monument)$"]',
)


def structures_query(bbox: BoundingBox) -> str:
    """Overpass QL for structure ways and relations in ``bbox``, with their geometry."""
    lines = [f"  way{tag}({bbox.overpass});" for tag in _STRUCTURE_FILTERS]
    lines.append(f'  relation["building"]({bbox.overpass});')
    body = "\n".join(lines)
    return f"[out:json][timeout:300][maxsize:536870912];\n(\n{body}\n);\nout geom;\n"


@dataclass(frozen=True)
class Outline:
    """A structure's outline in WGS84: a closed ring (polygon) or an open line."""

    points: tuple[tuple[float, float], ...]  # (lon, lat)

    @property
    def closed(self) -> bool:
        return len(self.points) >= 4 and self.points[0] == self.points[-1]


def _points(geometry: Iterable[dict[str, Any]]) -> tuple[tuple[float, float], ...]:
    return tuple(
        (float(p["lon"]), float(p["lat"]))
        for p in geometry
        if isinstance(p, dict) and "lat" in p and "lon" in p
    )


def parse_structures(data: dict[str, Any]) -> list[Outline]:
    """Every way, and every member way of a relation, in an ``out geom`` response."""
    outlines: list[Outline] = []
    for element in data.get("elements", []):
        if element.get("type") == "way":
            geometries = [element.get("geometry", [])]
        elif element.get("type") == "relation":
            geometries = [m.get("geometry", []) for m in element.get("members", [])]
        else:
            continue
        for geometry in geometries:
            points = _points(geometry)
            if len(points) >= 2:
                outlines.append(Outline(points))
    return outlines


def structures_mask(outlines: Sequence[Outline], grid: Grid) -> BoolArray:
    """Rasterize outlines onto ``grid``: closed rings filled, lines traced. Touched cells count."""
    to_grid = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    shapes: list[dict[str, Any]] = []
    for outline in outlines:
        xs, ys = to_grid.transform([p[0] for p in outline.points], [p[1] for p in outline.points])
        coords = [[float(x), float(y)] for x, y in zip(xs, ys, strict=True)]
        if outline.closed:
            shapes.append({"type": "Polygon", "coordinates": [coords]})
        # The outline itself too, so thin polygons and open lines (walls) are never missed.
        shapes.append({"type": "LineString", "coordinates": coords})
    if not shapes:
        return np.zeros((grid.height, grid.width), dtype=bool)
    burned = rasterize(
        ((shape, 1) for shape in shapes),
        out_shape=(grid.height, grid.width),
        transform=grid.transform,
        fill=0,
        all_touched=True,
        dtype="uint8",
    )
    return np.asarray(burned, dtype=bool)


def load_structures(
    bbox: BoundingBox = BADAJOZ_BBOX, cache_dir: Path = CACHE_DIR, *, refresh: bool = False
) -> list[Outline]:
    """Structure outlines in ``bbox``, from the cache or, if missing or ``refresh``, Overpass."""
    query = structures_query(bbox)
    with httpx.Client(timeout=httpx.Timeout(360.0, connect=15.0)) as client:
        data = cached_overpass(
            query, cache_dir, refresh=refresh, client=client, prefix="overpass_structures"
        )
    return parse_structures(data)


# --- Sentinel-2 NDVI composite ---------------------------------------------------------------

_SCENE_PATTERN = re.compile(r"^S2[A-D]_29SPD_(\d{8})_\d+_L2A$")


def parse_scene_listing(xml_text: str) -> list[str]:
    """Scene ids (e.g. ``S2A_29SPD_20250113_0_L2A``) in an S3 ListObjectsV2 response, sorted."""
    root = ET.fromstring(xml_text)
    scenes: set[str] = set()
    for element in root.iter():
        if element.tag.endswith("Prefix") and element.text:
            name = element.text.rstrip("/").rsplit("/", 1)[-1]
            if _SCENE_PATTERN.match(name):
                scenes.add(name)
    return sorted(scenes)


def scene_path(scene: str) -> str:
    """Bucket path of a scene folder, from its id."""
    match = _SCENE_PATTERN.match(scene)
    if match is None:
        raise ValueError(f"not a 29SPD L2A scene id: {scene}")
    day = match.group(1)
    return f"{S2_PREFIX}/{int(day[:4])}/{int(day[4:6])}/{scene}"


def list_scenes(year: int, months: Sequence[int], client: httpx.Client) -> list[str]:
    """Every 29SPD L2A scene of ``months`` of ``year`` in the bucket, sorted."""
    scenes: list[str] = []
    for month in months:
        response = client.get(
            S2_BUCKET_URL + "/",
            params={
                "list-type": "2",
                "prefix": f"{S2_PREFIX}/{year}/{month}/",
                "delimiter": "/",
            },
            headers={"User-Agent": USER_AGENT},
        )
        response.raise_for_status()
        scenes += parse_scene_listing(response.text)
    return sorted(scenes)


@dataclass(frozen=True)
class S2Window:
    """The bbox on the Sentinel-2 grid, snapped outwards to whole 20 m cells."""

    left: float
    bottom: float
    right: float
    top: float

    @property
    def shape(self) -> tuple[int, int]:
        """(rows, cols) at 10 m."""
        return (
            round((self.top - self.bottom) / S2_PIXEL_M),
            round((self.right - self.left) / S2_PIXEL_M),
        )

    @property
    def transform(self) -> Affine:
        return Affine.translation(self.left, self.top) @ Affine.scale(S2_PIXEL_M, -S2_PIXEL_M)


def s2_window(bbox: BoundingBox) -> S2Window:
    to_utm = Transformer.from_crs("EPSG:4326", S2_CRS, always_xy=True)
    xs, ys = to_utm.transform(
        [bbox.west, bbox.east, bbox.west, bbox.east],
        [bbox.south, bbox.south, bbox.north, bbox.north],
    )
    step = SCL_PIXEL_M
    return S2Window(
        left=math.floor(min(xs) / step) * step,
        bottom=math.floor(min(ys) / step) * step,
        right=math.ceil(max(xs) / step) * step,
        top=math.ceil(max(ys) / step) * step,
    )


# Reads one band of one scene over the window, at 10 m: (scene, band, window) -> array.
type BandReader = Callable[[str, str, S2Window], npt.NDArray[np.floating[Any]]]


def read_band(scene: str, band: str, window: S2Window) -> npt.NDArray[np.float64]:
    """One band of a scene over ``window`` from the public bucket, resampled to 10 m (nearest).

    Cells outside the scene's data come back as 0, which L2A uses for "no data".
    """
    url = f"/vsicurl/{S2_BUCKET_URL}/{scene_path(scene)}/{band}.tif"
    with (
        rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_USERAGENT=USER_AGENT),
        rasterio.open(url) as dataset,
    ):
        win = from_bounds(window.left, window.bottom, window.right, window.top, dataset.transform)
        data = dataset.read(
            1,
            window=win,
            out_shape=window.shape,
            resampling=Resampling.nearest,
            boundless=True,
            fill_value=0,
        )
    return np.asarray(data, dtype=np.float64)


def scene_ndvi(scene: str, window: S2Window, read: BandReader) -> tuple[FloatArray, float]:
    """NDVI of a scene over ``window`` (NaN where not clear), and its clear fraction."""
    scl = read(scene, "SCL", window)
    red = read(scene, "B04", window)
    nir = read(scene, "B08", window)
    clear = np.isin(scl, CLEAR_SCL) & (red > 0) & (nir > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (nir - red) / (nir + red)
    return np.where(clear, ndvi, np.nan), float(clear.mean())


def season_composite(
    scenes: Sequence[str], window: S2Window, read: BandReader
) -> tuple[FloatArray, list[str]]:
    """Median NDVI of the clearest scenes (at most ``MAX_SCENES_PER_SEASON``), and their ids.

    Scenes less than ``MIN_CLEAR_FRACTION`` clear over the window are skipped. Ties keep the
    earlier scene, so the choice is deterministic.

    Raises:
        ValueError: If no scene is clear enough.
    """
    candidates: list[tuple[float, str, FloatArray]] = []
    for scene in sorted(scenes):
        ndvi, clear = scene_ndvi(scene, window, read)
        log.info("%s: %.0f %% clear", scene, clear * 100)
        if clear >= MIN_CLEAR_FRACTION:
            candidates.append((clear, scene, ndvi))
    if not candidates:
        raise ValueError(f"no scene is {MIN_CLEAR_FRACTION:.0%} clear among {len(scenes)}")
    chosen = sorted(candidates, key=lambda c: (-c[0], c[1]))[:MAX_SCENES_PER_SEASON]
    stack = np.stack([ndvi for _, _, ndvi in chosen])
    # All-NaN pixels (never clear) stay NaN; numpy warns about them, which is expected.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        median = np.nanmedian(stack, axis=0)
    return median, sorted(scene for _, scene, _ in chosen)


def write_ndvi(
    path: Path, summer: FloatArray, winter: FloatArray, window: S2Window, scenes: Sequence[str]
) -> None:
    """Two-band float32 GeoTIFF (1 = summer, 2 = winter median NDVI), NaN where unknown."""
    path.parent.mkdir(parents=True, exist_ok=True)
    rows, cols = window.shape
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=cols,
        height=rows,
        count=2,
        dtype="float32",
        crs=S2_CRS,
        transform=window.transform,
        nodata=math.nan,
        compress="deflate",
        predictor=3,
    ) as dst:
        dst.write(np.asarray(summer, dtype=np.float32), 1)
        dst.write(np.asarray(winter, dtype=np.float32), 2)
        dst.update_tags(SCENES=",".join(scenes))


def ndvi_path(year: int, bbox: BoundingBox, cache_dir: Path = CACHE_DIR) -> Path:
    key = f"{year}|{bbox}|{SUMMER_MONTHS}|{WINTER_MONTHS}|{MAX_SCENES_PER_SEASON}"
    digest = hashlib.sha256(key.encode()).hexdigest()[:12]
    return cache_dir / f"sentinel2_ndvi_{year}_{digest}.tif"


def load_ndvi(
    year: int,
    bbox: BoundingBox = BADAJOZ_BBOX,
    cache_dir: Path = CACHE_DIR,
    *,
    refresh: bool = False,
    read: BandReader = read_band,
) -> Path:
    """Path of the NDVI composite for ``year``, computing and caching it if needed."""
    path = ndvi_path(year, bbox, cache_dir)
    if path.exists() and not refresh:
        log.info("using cached NDVI composite %s", path)
        return path
    window = s2_window(bbox)
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        summer_scenes = list_scenes(year, SUMMER_MONTHS, client)
        winter_scenes = list_scenes(year, WINTER_MONTHS, client)
    summer, summer_used = season_composite(summer_scenes, window, read)
    winter, winter_used = season_composite(winter_scenes, window, read)
    partial = path.with_suffix(".part.tif")
    write_ndvi(partial, summer, winter, window, summer_used + winter_used)
    partial.replace(path)
    log.info("NDVI composite from %s -> %s", ", ".join(summer_used + winter_used), path)
    return path


def ndvi_on_grid(path: Path, grid: Grid) -> tuple[FloatArray, FloatArray]:
    """Summer and winter NDVI resampled onto ``grid`` (nearest: each 2 m cell takes its pixel)."""
    bands: list[FloatArray] = []
    with rasterio.open(path) as src:
        for band in (1, 2):
            out = np.full((grid.height, grid.width), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(src, band),
                destination=out,
                src_transform=src.transform,
                src_crs=src.crs,
                src_nodata=math.nan,
                dst_transform=grid.transform,
                dst_crs=grid.crs,
                dst_nodata=math.nan,
                resampling=Resampling.nearest,
            )
            bands.append(out)
    return bands[0], bands[1]


# --- The step --------------------------------------------------------------------------------


def _read_grid(path: Path) -> tuple[npt.NDArray[np.float32], Grid, float | None]:
    with rasterio.open(path) as dataset:
        data = np.asarray(dataset.read(1), dtype=np.float32)
        grid = Grid(dataset.crs.to_string(), dataset.transform, dataset.width, dataset.height)
        nodata = None if dataset.nodata is None else float(dataset.nodata)
    return data, grid, nodata


def build_leafoff_dsm(
    dsm_path: Path,
    dtm_path: Path,
    ndvi: Path,
    outlines: Sequence[Outline],
    out_path: Path,
    *,
    year: int,
) -> int:
    """Write the leaf-off surface model; return the number of cells lowered."""
    dsm, grid, nodata = _read_grid(dsm_path)
    dtm, dtm_grid, _ = _read_grid(dtm_path)
    if dtm_grid != grid:
        raise ValueError(f"{dsm_path} and {dtm_path} must share one grid")
    summer, winter = ndvi_on_grid(ndvi, grid)
    surface, lowered = leaf_off_surface(
        dsm, dtm, structures_mask(outlines, grid), deciduous_mask(summer, winter), nodata=nodata
    )
    write_raster(out_path, surface, grid, SENTINEL_ATTRIBUTION.format(year=year))
    return int(lowered.sum())


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the leaf-off surface model (deciduous crowns lowered), ADR-0007."
    )
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR, help="Sentinel-2 composite year")
    parser.add_argument(
        "--refresh", action="store_true", help="download structures and Sentinel-2 again"
    )
    parser.add_argument("--dsm", type=Path, default=DSM_PATH)
    parser.add_argument("--dtm", type=Path, default=DTM_PATH)
    parser.add_argument("--out", type=Path, default=LEAFOFF_DSM_PATH)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    missing = [p for p in (args.dsm, args.dtm) if not p.exists()]
    if missing:
        log.error(
            "missing %s: run `python -m solycerveza.obstacles` first",
            ", ".join(str(p) for p in missing),
        )
        return 2
    outlines = load_structures(refresh=args.refresh)
    log.info("%d structure outlines from OSM", len(outlines))
    ndvi = load_ndvi(args.year, refresh=args.refresh)
    lowered = build_leafoff_dsm(args.dsm, args.dtm, ndvi, outlines, args.out, year=args.year)
    log.info("%d cells lowered -> %s", lowered, args.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

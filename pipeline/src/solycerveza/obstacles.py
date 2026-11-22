"""Obstacle surface (DSM) and terrain (DTM) rasters for Badajoz, from PNOA-LiDAR.

Run from ``pipeline/``::

    python -m solycerveza.obstacles               # local MDS02 + MDT02 sheets (preferred)
    python -m solycerveza.obstacles --source wcs  # automated MDS05 + MDT05 download (fallback)

Both write ``.cache/badajoz_dsm.tif`` and ``.cache/badajoz_dtm.tif``: float32 GeoTIFFs in
ETRS89 / UTM 29N (EPSG:25829) on one shared grid that covers ``BADAJOZ_BBOX``, with orthometric
heights in metres. Products, licence and caveats: ``docs/research/lidar.md``.
"""

import argparse
import email
import email.policy
import logging
import math
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np
import numpy.typing as npt
import rasterio  # type: ignore[import-untyped]
from affine import Affine
from pyproj import Transformer
from rasterio.enums import Resampling  # type: ignore[import-untyped]
from rasterio.warp import reproject  # type: ignore[import-untyped]

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox

log = logging.getLogger(__name__)

TARGET_CRS = "EPSG:25829"  # ETRS89 / UTM zone 29N: all of BADAJOZ_BBOX lies in zone 29.
NODATA = -9999.0
CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"  # pipeline/.cache (gitignored)
USER_AGENT = "sol-y-cerveza-pipeline/0.1 (+https://github.com/isroma/sol-y-cerveza)"

CNIG_DOWNLOADS = "https://centrodedescargas.cnig.es/CentroDescargas"
CNIG_MDS02_URL = f"{CNIG_DOWNLOADS}/modelo-digital-superficies-mds02-segunda-cobertura"
CNIG_MDT02_URL = f"{CNIG_DOWNLOADS}/modelo-digital-terreno-mdt02-segunda-cobertura"
# CC-BY 4.0 attribution for derived products ("Tipo 3" on each CNIG product page).
MDS02_ATTRIBUTION = "Obra derivada de MDS02 2015-2021 CC-BY 4.0 scne.es"
MDT02_ATTRIBUTION = "Obra derivada de MDT02-cob2 2015-2021 CC-BY 4.0 scne.es"


@dataclass(frozen=True)
class Sheet:
    """A map sheet frame in geographic degrees (ETRS89)."""

    id: str
    name: str
    west: float
    south: float
    east: float
    north: float

    def intersects(self, bbox: BoundingBox) -> bool:
        """True if the sheet and ``bbox`` share some area (touching edges don't count)."""
        return (
            self.west < bbox.east
            and bbox.west < self.east
            and self.south < bbox.north
            and bbox.south < self.north
        )


# MTN25 frames around Badajoz, as served by the IGN grid WMS (layer cuadricula-mtn25-actual,
# version 20260303, https://www.ign.es/wms-inspire/cuadriculas). CNIG cuts MDS02 and MDT02 by
# these frames.
# West of Badajoz the land is Portuguese: 0775-1 and 0775-3 don't exist, and 0775-2 and 0775-4
# are extended westwards instead.
MTN25_SHEETS = (
    Sheet("0750-4", "Bótoa", -7.020833, 39.0, -6.854167, 39.083333),
    Sheet("0751-3", "Valdesequera", -6.854167, 39.0, -6.6875, 39.083333),
    Sheet("0775-2", "Valdebótoa", -7.038889, 38.916667, -6.854167, 39.0),
    Sheet("0775-4", "Badajoz", -7.086111, 38.833333, -6.854167, 38.916667),
    Sheet("0776-1", "Guadiana", -6.854167, 38.916667, -6.6875, 39.0),
    Sheet("0776-3", "Talavera la Real", -6.854167, 38.833333, -6.6875, 38.916667),
    Sheet("0801-1", "Corazón de Jesús", -7.208333, 38.75, -7.020833, 38.833333),
    Sheet("0801-2", "Dehesilla de Calamón", -7.020833, 38.75, -6.854167, 38.833333),
    Sheet("0802-1", "Alvarado", -6.854167, 38.75, -6.6875, 38.833333),
)


def sheets_for_bbox(bbox: BoundingBox, sheets: Iterable[Sheet] = MTN25_SHEETS) -> list[str]:
    """Ids of the sheets that overlap ``bbox``, sorted.

    Raises ``ValueError`` if ``bbox`` reaches beyond the area the sheet list describes, so a
    bigger bbox can't silently miss sheets.
    """
    sheets = tuple(sheets)
    if not (
        min(s.west for s in sheets) <= bbox.west
        and bbox.east <= max(s.east for s in sheets)
        and min(s.south for s in sheets) <= bbox.south
        and bbox.north <= max(s.north for s in sheets)
    ):
        raise ValueError(f"bbox {bbox} reaches beyond the known sheets; add the missing ones")
    return sorted(s.id for s in sheets if s.intersects(bbox))


@dataclass(frozen=True)
class Grid:
    """A north-up raster grid."""

    crs: str
    transform: Affine
    width: int
    height: int

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        """(left, bottom, right, top) in ``crs`` units."""
        right, bottom = self.transform @ (self.width, self.height)
        return (self.transform.c, bottom, right, self.transform.f)


def grid_for_bbox(bbox: BoundingBox, resolution: float, crs: str = TARGET_CRS) -> Grid:
    """Grid covering ``bbox`` in ``crs``, with its edges snapped outwards to ``resolution``."""
    transformer = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    left, bottom, right, top = transformer.transform_bounds(
        bbox.west, bbox.south, bbox.east, bbox.north, densify_pts=21
    )
    left = math.floor(left / resolution) * resolution
    bottom = math.floor(bottom / resolution) * resolution
    right = math.ceil(right / resolution) * resolution
    top = math.ceil(top / resolution) * resolution
    return Grid(
        crs=crs,
        transform=Affine(resolution, 0.0, left, 0.0, -resolution, top),
        width=round((right - left) / resolution),
        height=round((top - bottom) / resolution),
    )


def mosaic(sources: Sequence[Path], grid: Grid) -> npt.NDArray[np.float32]:
    """Mosaic ``sources`` onto ``grid``, reprojecting and cropping as needed.

    Nearest-neighbour sampling keeps obstacle tops intact (a bilinear kernel would shave towers
    and tree crowns). Where tiles overlap, the first one in sorted path order wins. Cells no
    source covers are ``NODATA``.
    """
    out = np.full((grid.height, grid.width), NODATA, dtype=np.float32)
    tile = np.empty_like(out)
    for path in sorted(sources):
        with rasterio.open(path) as src:
            if src.crs is None:
                raise ValueError(f"{path} has no CRS")
            tile.fill(NODATA)
            reproject(
                source=rasterio.band(src, 1),
                destination=tile,
                src_nodata=src.nodata,
                dst_transform=grid.transform,
                dst_crs=grid.crs,
                dst_nodata=NODATA,
                resampling=Resampling.nearest,
            )
        gap = (out == NODATA) & (tile != NODATA)
        out[gap] = tile[gap]
    return out


def write_raster(path: Path, data: npt.NDArray[np.float32], grid: Grid, source: str) -> None:
    """Write ``data`` as a compressed float32 GeoTIFF, with ``source`` in its SOURCE tag."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=grid.width,
        height=grid.height,
        count=1,
        dtype="float32",
        crs=grid.crs,
        transform=grid.transform,
        nodata=NODATA,
        compress="deflate",
        predictor=3,
        tiled=True,
        blockxsize=512,
        blockysize=512,
    ) as dst:
        dst.write(data, 1)
        dst.update_tags(SOURCE=source)


@dataclass(frozen=True)
class WcsCoverage:
    """An elevation coverage on an IGN INSPIRE WCS 2.0 service."""

    name: str
    url: str
    coverage_id: str
    crs: str  # native CRS, in which the subset is requested
    attribution: str


# Automated fallback: 1st LiDAR coverage (Badajoz flown 2009-2010), 5 m.
MDS05_WCS = WcsCoverage(
    name="mds05",
    url="https://wcs-mds.idee.es/mds",
    coverage_id="mds05",
    crs="EPSG:25830",
    attribution="Obra derivada de MDS05 2008-2015 CC-BY 4.0 scne.es",
)
MDT05_WCS = WcsCoverage(
    name="mdt05",
    url="https://servicios.idee.es/wcs-inspire/mdt",
    coverage_id="Elevacion25830_5",
    crs="EPSG:25830",
    attribution="Obra derivada de MDT05-cob1 2008-2015 CC-BY 4.0 scne.es",
)


def wcs_subset(
    coverage: WcsCoverage, grid: Grid, margin: float = 50.0
) -> tuple[int, int, int, int]:
    """Area to request so it covers all of ``grid``: (left, bottom, right, top) in whole metres
    of the coverage's CRS, plus a margin.

    The UTM 29 and 30 grids are rotated about 3.8° from each other at Badajoz, so the request
    is the envelope of the whole target grid, not just of the bbox.
    """
    transformer = Transformer.from_crs(grid.crs, coverage.crs, always_xy=True)
    left, bottom, right, top = transformer.transform_bounds(*grid.bounds, densify_pts=21)
    return (
        math.floor(left - margin),
        math.floor(bottom - margin),
        math.ceil(right + margin),
        math.ceil(top + margin),
    )


def multipart_files(content_type: str, body: bytes) -> dict[str, bytes]:
    """Files in a multipart HTTP body, by file name. WCS 2.0 sends the grid plus its .prj."""
    header = f"Content-Type: {content_type}\r\n\r\n".encode()
    message = email.message_from_bytes(header + body, policy=email.policy.default)
    files: dict[str, bytes] = {}
    for part in message.iter_parts():
        name = part.get_filename()
        payload = part.get_payload(decode=True)
        if name and isinstance(payload, bytes):
            files[name] = payload
    return files


def fetch_wcs(coverage: WcsCoverage, grid: Grid, raw_dir: Path, client: httpx.Client) -> Path:
    """Download ``coverage`` over ``grid`` as an ESRI ASCII grid plus .prj; return the grid path.

    ASCII is the only float output these services offer: their GeoTIFF output is int16, which
    rounds heights to whole metres. Downloads are cached per requested area.
    """
    left, bottom, right, top = wcs_subset(coverage, grid)
    asc = raw_dir / f"{coverage.name}_{left}_{bottom}_{right}_{top}.asc"
    if asc.exists():
        log.info("using cached %s", asc)
        return asc
    log.info("downloading %s from %s", coverage.coverage_id, coverage.url)
    response = client.get(
        coverage.url,
        params=[
            ("service", "WCS"),
            ("version", "2.0.1"),
            ("request", "GetCoverage"),
            ("CoverageId", coverage.coverage_id),
            ("subset", f"x({left},{right})"),
            ("subset", f"y({bottom},{top})"),
            ("format", "application/asc"),
        ],
    )
    response.raise_for_status()
    files = multipart_files(response.headers.get("content-type", ""), response.content)
    grid_bytes = next((v for k, v in files.items() if k.endswith(".asc")), None)
    prj_bytes = next((v for k, v in files.items() if k.endswith(".prj")), None)
    if grid_bytes is None or prj_bytes is None:
        raise RuntimeError(f"unexpected WCS response from {coverage.url}: {response.text[:500]}")
    raw_dir.mkdir(parents=True, exist_ok=True)
    asc.with_suffix(".prj").write_bytes(prj_bytes)
    asc.write_bytes(grid_bytes)  # last, so an interrupted run doesn't leave a "cached" grid
    return asc


def find_tiles(directory: Path) -> list[Path]:
    """GeoTIFF files in ``directory``, sorted."""
    if not directory.is_dir():
        return []
    return sorted(p for p in directory.iterdir() if p.suffix.lower() in {".tif", ".tiff"})


def manual_download_help(dsm_dir: Path, dtm_dir: Path) -> str:
    """Steps to fetch the MDS02/MDT02 sheets by hand (CNIG downloads sit behind a reCAPTCHA)."""
    sheets = ", ".join(sheets_for_bbox(BADAJOZ_BBOX))
    return f"""\
Missing local LiDAR tiles. CNIG downloads sit behind a reCAPTCHA, so get them by hand:
  1. Open {CNIG_MDS02_URL}
     and {CNIG_MDT02_URL}
  2. In each, filter by "Hoja MTN50" = 0775 and download the MTN25 sheets {sheets}.
  3. Put the MDS02 files in {dsm_dir}
     and the MDT02 files in {dtm_dir}
  4. Run this command again.
Or pass --source wcs to download the older, coarser 1st-coverage MDS05/MDT05 automatically.
Details: docs/research/lidar.md"""


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m solycerveza.obstacles",
        description="Build the Badajoz DSM and DTM (EPSG:25829) from PNOA-LiDAR.",
    )
    parser.add_argument(
        "--source",
        choices=("local", "wcs"),
        default="local",
        help="local: MDS02/MDT02 sheets downloaded by hand (default); "
        "wcs: download MDS05/MDT05 from the IGN WCS services",
    )
    parser.add_argument("--dsm-dir", type=Path, default=CACHE_DIR / "cnig" / "mds02")
    parser.add_argument("--dtm-dir", type=Path, default=CACHE_DIR / "cnig" / "mdt02")
    parser.add_argument("--wcs-dir", type=Path, default=CACHE_DIR / "wcs")
    parser.add_argument("--out-dir", type=Path, default=CACHE_DIR)
    parser.add_argument("--resolution", type=float, default=2.0, help="output cell size (m)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    grid = grid_for_bbox(BADAJOZ_BBOX, args.resolution)
    if args.source == "wcs":
        with httpx.Client(
            headers={"User-Agent": USER_AGENT},
            timeout=httpx.Timeout(30.0, read=300.0),
            transport=httpx.HTTPTransport(retries=3),
        ) as client:
            dsm = [fetch_wcs(MDS05_WCS, grid, args.wcs_dir, client)]
            dtm = [fetch_wcs(MDT05_WCS, grid, args.wcs_dir, client)]
        outputs = [("dsm", dsm, MDS05_WCS.attribution), ("dtm", dtm, MDT05_WCS.attribution)]
    else:
        dsm, dtm = find_tiles(args.dsm_dir), find_tiles(args.dtm_dir)
        if not dsm or not dtm:
            print(manual_download_help(args.dsm_dir, args.dtm_dir), file=sys.stderr)
            return 2
        outputs = [("dsm", dsm, MDS02_ATTRIBUTION), ("dtm", dtm, MDT02_ATTRIBUTION)]

    for kind, sources, attribution in outputs:
        data = mosaic(sources, grid)
        valid = data != NODATA
        if not valid.any():
            raise RuntimeError(f"no {kind} source overlaps the Badajoz bbox: {sources}")
        path = args.out_dir / f"badajoz_{kind}.tif"
        write_raster(path, data, grid, attribution)
        log.info(
            "wrote %s: %dx%d cells of %g m, %.1f%% covered, heights %.1f-%.1f m",
            path,
            grid.width,
            grid.height,
            args.resolution,
            100 * valid.mean(),
            data[valid].min(),
            data[valid].max(),
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())

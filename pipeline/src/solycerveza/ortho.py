"""Crops of the PNOA orthophoto around a venue, for the terrace proposer (ADR-0008).

Source: IGN's WMS "PNOA máxima actualidad" (the most recent PNOA flight over each area),
`https://www.ign.es/wms-inspire/pnoa-ma`, layer `OI.OrthoimageCoverage`. Licence CC BY 4.0,
attribution "PNOA cedido por © Instituto Geográfico Nacional de España" (scne.es); see
docs/research/orthophoto-proposals.md.

A crop is a square of `2 * radius_m` metres centred on the venue, north up, in ETRS89 / UTM
29N (EPSG:25829, the pipeline's raster CRS), so a pixel is a fixed number of metres and
`Crop.to_latlon` maps a pixel back to WGS84 exactly. Only `fetch_crop` touches the network;
every image is cached in `.cache/ortho/`, one JPEG per request URL.
"""

import hashlib
import logging
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlencode

import httpx
from pyproj import Transformer

from solycerveza.venues import CACHE_DIR, USER_AGENT, LatLon

logger = logging.getLogger(__name__)

WMS_URL = "https://www.ign.es/wms-inspire/pnoa-ma"
LAYER = "OI.OrthoimageCoverage"
CRS = "EPSG:25829"
ORTHO_CACHE = CACHE_DIR / "ortho"
RADIUS_M = 60.0
SIZE_PX = 800  # 120 m / 800 px = 0.15 m per pixel; the flight itself is about 0.25 m
DELAY_S = 1.0
TIMEOUT = httpx.Timeout(30.0, connect=10.0)

_TO_UTM = Transformer.from_crs("EPSG:4326", CRS, always_xy=True)
_TO_WGS84 = Transformer.from_crs(CRS, "EPSG:4326", always_xy=True)


@dataclass(frozen=True)
class Crop:
    """A square crop: its centre (the venue), half-width in metres and size in pixels."""

    centre: LatLon
    radius_m: float = RADIUS_M
    size_px: int = SIZE_PX

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """(min easting, min northing, max easting, max northing) in EPSG:25829."""
        x, y = _TO_UTM.transform(self.centre.lon, self.centre.lat)
        r = self.radius_m
        return (x - r, y - r, x + r, y + r)

    @property
    def metres_per_px(self) -> float:
        return 2 * self.radius_m / self.size_px

    @property
    def url(self) -> str:
        """The WMS 1.3.0 GetMap request (EPSG:25829 axis order is easting, northing)."""
        params = {
            "SERVICE": "WMS",
            "VERSION": "1.3.0",
            "REQUEST": "GetMap",
            "LAYERS": LAYER,
            "STYLES": "",
            "CRS": CRS,
            "BBOX": ",".join(f"{v:.2f}" for v in self.bbox),
            "WIDTH": str(self.size_px),
            "HEIGHT": str(self.size_px),
            "FORMAT": "image/jpeg",
        }
        return f"{WMS_URL}?{urlencode(params)}"

    def to_latlon(self, x_px: float, y_px: float) -> LatLon:
        """WGS84 position of the centre of pixel (x, y); (0, 0) is the top-left pixel."""
        west, _, _, north = self.bbox
        easting = west + (x_px + 0.5) * self.metres_per_px
        northing = north - (y_px + 0.5) * self.metres_per_px
        lon, lat = _TO_WGS84.transform(easting, northing)
        return LatLon(lat=lat, lon=lon)


def cache_file(crop: Crop, cache_dir: Path = ORTHO_CACHE) -> Path:
    return cache_dir / f"{hashlib.sha256(crop.url.encode()).hexdigest()[:24]}.jpg"


def cached_crop(crop: Crop, cache_dir: Path = ORTHO_CACHE) -> bytes | None:
    path = cache_file(crop, cache_dir)
    return path.read_bytes() if path.exists() else None


@dataclass
class OrthoFetcher:
    """Downloads crops one at a time, at least `delay_s` apart, and caches them."""

    client: httpx.Client
    cache_dir: Path = ORTHO_CACHE
    delay_s: float = DELAY_S
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    requests: int = 0
    _last: float | None = field(default=None)

    def crop(self, crop: Crop) -> bytes | None:
        """The JPEG for `crop`, from the cache or IGN; None if the service did not give one."""
        cached = cached_crop(crop, self.cache_dir)
        if cached is not None:
            return cached
        if self._last is not None:
            remaining = self.delay_s - (self.clock() - self._last)
            if remaining > 0:
                self.sleep(remaining)
        self.requests += 1
        try:
            response = self.client.get(
                crop.url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
            )
        except httpx.HTTPError as error:
            logger.warning("orthophoto %s: %r", crop.url, error)
            return None
        finally:
            self._last = self.clock()
        content_type = response.headers.get("content-type", "").split(";")[0].strip()
        # A WMS reports errors as XML with status 200, so the type is checked too.
        if response.status_code != 200 or content_type != "image/jpeg":
            logger.warning(
                "orthophoto %s: HTTP %d %s", crop.url, response.status_code, content_type
            )
            return None
        path = cache_file(crop, self.cache_dir)
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_bytes(response.content)
        partial.replace(path)
        return response.content

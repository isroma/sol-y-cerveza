"""Fetch venues (bars, pubs, cafes, restaurants, beer gardens) from OpenStreetMap via Overpass.

`load_venues` is the entry point: it downloads the raw Overpass JSON once, caches it under
`pipeline/.cache/` and normalizes it into `Venue` records. Only `fetch_overpass` touches the
network. OSM data is © OpenStreetMap contributors, ODbL.
"""

import hashlib
import json
import logging
import time
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Annotated, Any, Literal, TypeIs

import httpx
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox

logger = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parents[2] / ".cache"

# Tried in order on every attempt; public instances are often at capacity.
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
USER_AGENT = "sol-y-cerveza-pipeline (+https://github.com/isroma/sol-y-cerveza)"
RETRYABLE_STATUS = frozenset({429, 502, 503, 504})

Kind = Literal["bar", "pub", "cafe", "restaurant", "biergarten"]
KINDS: tuple[Kind, ...] = ("bar", "pub", "cafe", "restaurant", "biergarten")
# OSM elements, Overture places (GERS ids), Junta register rows, or venues added in the admin view.
# Unanchored, so record ids (`terraces.TERRACE_ID_PATTERN`) can extend it without drifting.
VENUE_ID_ALTERNATIVES = (
    r"osm:(node|way)/\d+|overture:[0-9A-Za-z-]+|junta:[0-9a-f]{12}|review:[a-z0-9]+(-[a-z0-9]+)*"
)
VENUE_ID_PATTERN = rf"^({VENUE_ID_ALTERNATIVES})$"


def venue_source(venue_id: str) -> str:
    """The source a venue id comes from: "osm", "overture", "junta" or "review"."""
    return venue_id.split(":", 1)[0]


def is_kind(value: object) -> TypeIs[Kind]:
    return value in KINDS


# OSM amenities listed as one of our kinds: fast food places have terraces and serve beer too.
AMENITY_KINDS: dict[str, Kind] = {**{kind: kind for kind in KINDS}, "fast_food": "restaurant"}


def amenity_kind(amenity: object) -> Kind | None:
    """Our kind for an OSM `amenity` value, or None if we don't list it."""
    return AMENITY_KINDS.get(amenity) if isinstance(amenity, str) else None


def _round6(value: float) -> float:
    return round(value, 6)


Lat = Annotated[float, Field(ge=-90, le=90), AfterValidator(_round6)]
Lon = Annotated[float, Field(ge=-180, le=180), AfterValidator(_round6)]


class LatLon(BaseModel):
    """WGS84 position in degrees, rounded to 6 decimals (about 0.1 m)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    lat: Lat
    lon: Lon


class Venue(BaseModel):
    """A venue as OSM knows it."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    name: str | None
    kind: Kind
    location: LatLon  # node position, or the centre of a way
    outdoor_seating: str | None  # raw `outdoor_seating` tag value, e.g. "yes" or "no"


class OverpassError(RuntimeError):
    """No Overpass instance returned a usable response."""


def build_query(bbox: BoundingBox) -> str:
    """Overpass QL for every venue and outdoor-seating area in `bbox`, with tags and centres."""
    amenity = f'["amenity"~"^({"|".join(AMENITY_KINDS)})$"]'
    seating = '["leisure"="outdoor_seating"]'
    return (
        "[out:json][timeout:90];\n"
        "(\n"
        f"  node{amenity}({bbox.overpass});\n"
        f"  way{amenity}({bbox.overpass});\n"
        f"  node{seating}({bbox.overpass});\n"
        f"  way{seating}({bbox.overpass});\n"
        ");\n"
        "out tags center;\n"
    )


def fetch_overpass(
    query: str,
    *,
    client: httpx.Client,
    urls: Sequence[str] = OVERPASS_URLS,
    attempts: int = 4,
    backoff_s: float = 5.0,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    """POST `query` and return the raw JSON text.

    Each attempt tries every instance in `urls`; between attempts it waits `backoff_s`, doubling
    every time. Overload (429/5xx), transport errors, non-JSON bodies and Overpass runtime errors
    (a 200 status with an error `remark`) are retried. Other HTTP errors, such as a bad query,
    raise at once.
    """
    failures: list[str] = []
    for attempt in range(attempts):
        if attempt:
            delay = backoff_s * 2 ** (attempt - 1)
            logger.warning("all Overpass instances failed, retrying in %.0f s", delay)
            sleep(delay)
        for url in urls:
            try:
                response = client.post(
                    url, data={"data": query}, headers={"User-Agent": USER_AGENT}
                )
            except httpx.TransportError as error:
                failures.append(f"{url}: {error!r}")
                continue
            if response.status_code in RETRYABLE_STATUS:
                failures.append(f"{url}: HTTP {response.status_code}")
                continue
            response.raise_for_status()
            try:
                remark = str(response.json().get("remark", ""))
            except ValueError:  # not JSON: a gateway error page or a truncated body
                failures.append(f"{url}: response is not JSON")
                continue
            if "error" in remark.lower():
                failures.append(f"{url}: {remark}")
                continue
            return response.text
    raise OverpassError(f"Overpass failed after {attempts} attempts: " + "; ".join(failures))


def cached_overpass(
    query: str,
    cache_dir: Path,
    *,
    refresh: bool = False,
    client: httpx.Client,
    prefix: str = "overpass_venues",
) -> dict[str, Any]:
    """Return the Overpass JSON for `query`, downloading it only if it is not cached yet.

    The file name holds a hash of the query, so editing the query never reuses a stale download.
    """
    digest = hashlib.sha256(query.encode()).hexdigest()[:12]
    path = cache_dir / f"{prefix}_{digest}.json"
    if refresh or not path.exists():
        text = fetch_overpass(query, client=client)
        cache_dir.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        partial.write_text(text, encoding="utf-8")
        partial.replace(path)
        logger.info("cached Overpass response in %s", path)
    else:
        logger.info("using cached Overpass response %s", path)
    data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
    return data


class _Center(BaseModel):
    lat: float
    lon: float


class _Element(BaseModel):
    """The fields we use from an `out tags center` element."""

    type: Literal["node", "way"]
    id: int
    lat: float | None = None
    lon: float | None = None
    center: _Center | None = None
    tags: dict[str, str] = Field(default_factory=dict)


class SeatingArea(BaseModel):
    """An OSM `leisure=outdoor_seating` point or area: where a terrace's tables are."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=r"^osm:(node|way)/\d+$")]
    name: str | None
    location: LatLon


def _position(element: _Element) -> LatLon | None:
    if element.center is not None:
        return LatLon(lat=element.center.lat, lon=element.center.lon)
    if element.lat is not None and element.lon is not None:
        return LatLon(lat=element.lat, lon=element.lon)
    return None


def parse_seating(data: dict[str, Any]) -> list[SeatingArea]:
    """The `leisure=outdoor_seating` elements of an Overpass response, sorted by id."""
    areas: list[SeatingArea] = []
    for raw in data.get("elements", []):
        element = _Element.model_validate(raw)
        position = _position(element)
        if element.tags.get("leisure") != "outdoor_seating" or position is None:
            continue
        areas.append(
            SeatingArea(
                id=f"osm:{element.type}/{element.id}",
                name=element.tags.get("name"),
                location=position,
            )
        )
    return sorted(areas, key=lambda area: area.id)


def parse_venues(data: dict[str, Any]) -> list[Venue]:
    """Normalize an Overpass JSON response into venues sorted by id."""
    venues: list[Venue] = []
    for raw in data.get("elements", []):
        element = _Element.model_validate(raw)
        kind = amenity_kind(element.tags.get("amenity"))
        # Unnamed fast food is mostly kiosks and stalls, not a place to sit.
        if kind is None or (
            element.tags.get("amenity") == "fast_food" and not element.tags.get("name")
        ):
            continue
        if element.center is not None:
            lat, lon = element.center.lat, element.center.lon
        elif element.lat is not None and element.lon is not None:
            lat, lon = element.lat, element.lon
        else:
            logger.warning("skipping osm:%s/%d: no position", element.type, element.id)
            continue
        venues.append(
            Venue(
                id=f"osm:{element.type}/{element.id}",
                name=element.tags.get("name"),
                kind=kind,
                location=LatLon(lat=lat, lon=lon),
                outdoor_seating=element.tags.get("outdoor_seating"),
            )
        )
    return sorted(venues, key=lambda venue: venue.id)


class StreetAddress(BaseModel):
    """An OSM `addr:street` and `addr:housenumber` pair, as tagged."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    street: str
    housenumber: str


def parse_addresses(data: dict[str, Any]) -> dict[str, StreetAddress]:
    """Venue id -> its `addr:street` and `addr:housenumber`, for venues tagged with both."""
    addresses: dict[str, StreetAddress] = {}
    for raw in data.get("elements", []):
        element = _Element.model_validate(raw)
        street = element.tags.get("addr:street", "").strip()
        number = element.tags.get("addr:housenumber", "").strip()
        if amenity_kind(element.tags.get("amenity")) is None or not street or not number:
            continue
        addresses[f"osm:{element.type}/{element.id}"] = StreetAddress(
            street=street, housenumber=number
        )
    return dict(sorted(addresses.items()))


def load_venues(
    bbox: BoundingBox = BADAJOZ_BBOX,
    cache_dir: Path = CACHE_DIR,
    *,
    refresh: bool = False,
    client: httpx.Client | None = None,
) -> list[Venue]:
    """Venues in `bbox`, from the cache or, if missing or `refresh`, from Overpass."""
    query = build_query(bbox)
    if client is not None:
        return parse_venues(cached_overpass(query, cache_dir, refresh=refresh, client=client))
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as own_client:
        return parse_venues(cached_overpass(query, cache_dir, refresh=refresh, client=own_client))


def load_seating(
    bbox: BoundingBox = BADAJOZ_BBOX,
    cache_dir: Path = CACHE_DIR,
    *,
    refresh: bool = False,
) -> list[SeatingArea]:
    """Outdoor-seating areas in `bbox`, from the same cached Overpass response as the venues."""
    query = build_query(bbox)
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        return parse_seating(cached_overpass(query, cache_dir, refresh=refresh, client=client))


def load_addresses(
    bbox: BoundingBox = BADAJOZ_BBOX,
    cache_dir: Path = CACHE_DIR,
    *,
    refresh: bool = False,
) -> dict[str, StreetAddress]:
    """OSM venues' street addresses, from the same cached Overpass response as the venues."""
    query = build_query(bbox)
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        return parse_addresses(cached_overpass(query, cache_dir, refresh=refresh, client=client))

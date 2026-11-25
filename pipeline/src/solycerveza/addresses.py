"""Venues' own street addresses, outside the Junta register, geocoded by CartoCiudad (ADR-0008).

Two origins, each kept apart so the trial can score them separately:

- `osm`: the `addr:street` and `addr:housenumber` tags of OSM venues, from the cached Overpass
  response (`solycerveza.venues.load_addresses`).
- `overture`: the `addresses[].freeform` lines of Overture places, from the cached parquet
  (`solycerveza.overture.read_addresses`).

Each address is cut to a street and a number with the register's own parser
(`solycerveza.junta.split_address`; "s/n" and addresses without a number are dropped) and looked
up with the register's `Geocoder`, sharing its cache (`pipeline/.cache/cartociudad_portals_v2.json`)
and its rule: only a portal at exactly that street number counts.
"""

import logging
import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from solycerveza.junta import PORTALS_CACHE, Geocoder, split_address
from solycerveza.venues import CACHE_DIR, USER_AGENT, LatLon, StreetAddress

logger = logging.getLogger(__name__)

Origin = Literal["osm", "overture"]
ORIGINS: tuple[Origin, ...] = ("osm", "overture")


@dataclass(frozen=True)
class Address:
    """A venue's own address, cut to what CartoCiudad needs."""

    venue_id: str
    origin: Origin
    text: str  # as the source gives it, for the evidence
    street: str  # normalized: "CALLE SAN JUAN"
    number: str  # digits only


def osm_address(venue_id: str, tags: StreetAddress) -> Address | None:
    """An OSM address, or None when the house number does not start with digits."""
    match = re.match(r"^\s*(\d+)", tags.housenumber)
    if match is None:
        return None
    parsed = split_address(f"{tags.street}, {match.group(1)}")
    if parsed is None:
        return None
    return Address(
        venue_id=venue_id,
        origin="osm",
        text=f"{tags.street} {tags.housenumber}",
        street=parsed[0],
        number=parsed[1],
    )


def overture_address(venue_id: str, lines: Iterable[str]) -> Address | None:
    """The first of a place's freeform lines that has a street and a number."""
    for line in lines:
        parsed = split_address(line)
        if parsed is not None:
            return Address(
                venue_id=venue_id,
                origin="overture",
                text=" ".join(line.split()),
                street=parsed[0],
                number=parsed[1],
            )
    return None


def collect_addresses(
    venue_ids: Iterable[str],
    osm: Mapping[str, StreetAddress],
    overture: Mapping[str, list[str]],
) -> list[Address]:
    """The usable address of each venue, by origin, sorted by venue id then origin."""
    found: list[Address] = []
    for venue_id in sorted(set(venue_ids)):
        if venue_id in osm:
            address = osm_address(venue_id, osm[venue_id])
            if address is not None:
                found.append(address)
        if venue_id in overture:
            address = overture_address(venue_id, overture[venue_id])
            if address is not None:
                found.append(address)
    return found


def geocode(addresses: Iterable[Address], geocoder: Geocoder) -> list[tuple[Address, LatLon]]:
    """The addresses CartoCiudad places at their exact street number, with that portal."""
    located: list[tuple[Address, LatLon]] = []
    for address in addresses:
        portal = geocoder.portal(address.street, address.number)
        if portal is not None:
            located.append((address, portal))
    return located


def locate_addresses(
    addresses: Iterable[Address], cache_dir: Path = CACHE_DIR
) -> list[tuple[Address, LatLon]]:
    """`geocode` with the register's cached CartoCiudad lookups (the fetch stage)."""
    wanted = list(addresses)
    with httpx.Client(
        headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(60.0), follow_redirects=True
    ) as client:
        geocoder = Geocoder(cache_dir / PORTALS_CACHE, client)
        try:
            located = geocode(wanted, geocoder)
        finally:
            geocoder.save()
    for origin in ORIGINS:
        logger.info(
            "%s addresses: %d usable, %d at an exact street number",
            origin,
            sum(a.origin == origin for a in wanted),
            sum(a.origin == origin for a, _ in located),
        )
    return located

import json
from pathlib import Path

import httpx
import pytest

from solycerveza.addresses import (
    PORTALS_CACHE,
    Address,
    collect_addresses,
    geocode,
    locate_addresses,
    osm_address,
    overture_address,
)
from solycerveza.junta import Geocoder
from solycerveza.venues import LatLon, StreetAddress


@pytest.mark.parametrize(
    ("street", "number", "expected"),
    [
        ("Calle Mayor", "1", ("CALLE MAYOR", "1")),
        ("Avenida de Elvas", "36A", ("AVENIDA DE ELVAS", "36")),
        ("Plaza de España", "7-9", ("PLAZA DE ESPAÑA", "7")),
        ("Calle Mayor", "s/n", None),
    ],
)
def test_osm_address(street: str, number: str, expected: tuple[str, str] | None) -> None:
    address = osm_address("osm:node/1", StreetAddress(street=street, housenumber=number))
    assert (None if address is None else (address.street, address.number)) == expected


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (["Av. de Elvas, 5"], ("AVENIDA DE ELVAS", "5")),
        (["Avenida De Elvas 7"], ("AVENIDA DE ELVAS", "7")),
        (["Calle Nevero 13, Calle Nevero Trece, 26"], ("CALLE NEVERO", "13")),
        (["C.C. El Faro, Av. de Elvas, s/n"], None),
        (["Badajoz", "C. Mayor, 2"], ("CALLE MAYOR", "2")),  # the first usable line
        ([], None),
    ],
)
def test_overture_address(lines: list[str], expected: tuple[str, str] | None) -> None:
    address = overture_address("overture:a", lines)
    assert (None if address is None else (address.street, address.number)) == expected


def test_collect_addresses_keeps_each_origin_sorted() -> None:
    found = collect_addresses(
        ["overture:b", "osm:node/1", "overture:a", "osm:node/2"],
        {"osm:node/1": StreetAddress(street="Calle Mayor", housenumber="1")},
        {"overture:a": ["Calle Sol, 3"], "overture:b": ["Avenida de Elvas, s/n"]},
    )
    assert [(a.venue_id, a.origin, a.street, a.number) for a in found] == [
        ("osm:node/1", "osm", "CALLE MAYOR", "1"),
        ("overture:a", "overture", "CALLE SOL", "3"),
    ]


def address(venue_id: str, street: str, number: str) -> Address:
    return Address(
        venue_id=venue_id,
        origin="overture",
        text=f"{street} {number}",
        street=street,
        number=number,
    )


def test_geocode_keeps_exact_street_numbers_only(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "type": "portal",
                    "portalNumber": 1,
                    "address": "CALLE MAYOR 1, Badajoz",
                    "lat": 38.88,
                    "lng": -6.97,
                }
            ],
        )

    client = httpx.Client(transport=httpx.MockTransport(handler))
    geocoder = Geocoder(tmp_path / "cache.json", client, delay_s=0)
    hit, miss = address("overture:a", "CALLE MAYOR", "1"), address("overture:b", "CALLE MAYOR", "3")
    assert geocode([hit, miss], geocoder) == [(hit, LatLon(lat=38.88, lon=-6.97))]


def test_locate_addresses_reuses_the_register_cache(tmp_path: Path) -> None:
    (tmp_path / PORTALS_CACHE).write_text(
        json.dumps({"CALLE MAYOR|1": [38.88, -6.97], "CALLE SOL|3": None}), encoding="utf-8"
    )
    hit, miss = address("overture:a", "CALLE MAYOR", "1"), address("overture:b", "CALLE SOL", "3")
    # Both are cached, so no request is made (the network is not reachable in tests).
    assert locate_addresses([hit, miss], tmp_path) == [(hit, LatLon(lat=38.88, lon=-6.97))]

from datetime import date
from pathlib import Path
from typing import Any

import httpx
import pytest

from solycerveza.junta import (
    Geocoder,
    RegisterRow,
    add_register_venues,
    parse_register,
    pick_portal,
    register_id,
    split_address,
    title_name,
)
from solycerveza.venues import LatLon, Venue

HEADER = (
    '"Provincia","Modalidad","Tipo recurso","Categoría","exp_fecapertura",'
    '"Nombre establecimiento","Municipio","Dirección","C. Postal","Web","Nº Plazas"'
)


@pytest.mark.parametrize(
    ("address", "expected"),
    [
        ("C/ LAS LAVANDERAS, 1 - LOCAL D", ("CALLE LAS LAVANDERAS", "1")),
        ("AVDA. DE EUROPA, Nº 3", ("AVENIDA DE EUROPA", "3")),
        ("PZA. ALTA 12 (BAJO)", ("PLAZA ALTA", "12")),
        ("CTRA. DE CACERES KM 3", None),
        ("CALLE SIN NUMERO S/N", None),
    ],
)
def test_split_address(address: str, expected: tuple[str, str] | None) -> None:
    assert split_address(address) == expected


def test_title_name_keeps_small_words_lowercase() -> None:
    assert title_name("BAR LA ESQUINA DEL ARCO") == "Bar La Esquina del Arco"
    assert title_name("CAMALEÓNICO") == "Camaleónico"
    assert title_name("LAS ENCINAS II") == "Las Encinas II"
    assert title_name("S.I.M.A.G.O") == "S.I.M.A.G.O"
    assert title_name("VIVA LA VIDA") == "Viva La Vida"


def register_line(modalidad: str, opened: str, name: str, town: str, address: str, cp: str) -> str:
    return f'"Badajoz","{modalidad}","I","--","{opened}","{name}","{town}","{address}",{cp},"NO",0'


def test_parse_register_keeps_city_bars_with_a_number() -> None:
    text = "\n".join(
        [
            HEADER,
            register_line(
                "Café - Bar", "2022-06-15", "CAMALEÓNICO", "BADAJOZ", "C/ LAS LAVANDERAS, 1", "6006"
            ),
            register_line(
                "Restaurante", "1996-03-26", "LOS JAMONES", "ACEDERA", "PLAZA IGLESIA, 11", ""
            ),
            register_line("Catering", "2020-01-01", "CATERING X", "BADAJOZ", "C/ MAYOR, 2", "6001"),
            register_line("Pub", "", "PUB SIN FECHA", "BADAJOZ", "C/ MAYOR, 4", "6001"),
            register_line("Pub", "2020-01-01", "PUB PEDANIA", "BADAJOZ", "C/ MAYOR, 6", "6195"),
        ]
    )
    rows = parse_register(text)
    assert [(r.name, r.kind, r.street, r.number, r.opened) for r in rows] == [
        ("Camaleónico", "bar", "CALLE LAS LAVANDERAS", "1", date(2022, 6, 15)),
        ("Pub Sin Fecha", "pub", "CALLE MAYOR", "4", None),
    ]


def candidate(**fields: object) -> dict[str, Any]:
    return {
        "type": "portal",
        "address": "CALLE LAVANDERAS LAS 1, Badajoz",
        "portalNumber": 1,
        "lat": 38.88,
        "lng": -6.97,
        **fields,
    }


def test_pick_portal_needs_the_exact_number_and_a_similar_street() -> None:
    assert pick_portal([candidate()], "CALLE LAS LAVANDERAS", "1") == LatLon(lat=38.88, lon=-6.97)
    assert pick_portal([candidate(portalNumber=3)], "CALLE LAS LAVANDERAS", "1") is None
    assert (
        pick_portal([candidate(address="CALLE MAYOR 1, Badajoz")], "CALLE LAS LAVANDERAS", "1")
        is None
    )
    assert pick_portal([candidate(type="callejero")], "CALLE LAS LAVANDERAS", "1") is None


def test_geocoder_caches_answers(tmp_path: Path) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json=[candidate()])

    client = httpx.Client(transport=httpx.MockTransport(handler))
    geocoder = Geocoder(tmp_path / "cache.json", client, delay_s=0)
    assert geocoder.portal("CALLE LAS LAVANDERAS", "1") == LatLon(lat=38.88, lon=-6.97)
    assert geocoder.portal("CALLE LAS LAVANDERAS", "1") == LatLon(lat=38.88, lon=-6.97)
    assert len(calls) == 1
    geocoder.save()
    assert sorted(p.name for p in tmp_path.iterdir()) == ["cache.json"]  # written atomically
    again = Geocoder(tmp_path / "cache.json", client, delay_s=0)
    assert again.portal("CALLE LAS LAVANDERAS", "1") == LatLon(lat=38.88, lon=-6.97)
    assert len(calls) == 1


def row(name: str, year: int | None) -> RegisterRow:
    return RegisterRow(
        name=name,
        kind="bar",
        street="CALLE MAYOR",
        number="1",
        opened=None if year is None else date(year, 1, 1),
    )


def test_register_rows_confirm_matches_and_add_only_recent_unmatched_venues() -> None:
    existing = [
        Venue(
            id="osm:node/1",
            name="La Marina",
            kind="bar",
            location=LatLon(lat=38.88, lon=-6.97),
            outdoor_seating=None,
        )
    ]
    here = LatLon(lat=38.8801, lon=-6.97)
    far = LatLon(lat=38.89, lon=-6.98)
    venues, confirmed = add_register_venues(
        existing,
        [
            (row("Bar La Marina", 1990), here),
            (row("Nuevo Bar", 2021), far),
            (row("Viejo Bar", 1995), far),
        ],
    )
    assert confirmed == 1
    assert sorted(v.name or "" for v in venues) == ["La Marina", "Nuevo Bar"]
    added = next(v for v in venues if v.name == "Nuevo Bar")
    assert added.id == register_id(row("Nuevo Bar", 2021))
    assert added.id.startswith("junta:")


def test_geocoder_retries_server_errors_and_does_not_cache_failures(tmp_path: Path) -> None:
    answers = iter([httpx.Response(500), httpx.Response(200, json=[candidate()])])
    client = httpx.Client(transport=httpx.MockTransport(lambda _request: next(answers)))
    geocoder = Geocoder(tmp_path / "cache.json", client, delay_s=0)
    assert geocoder.portal("CALLE LAS LAVANDERAS", "1") == LatLon(lat=38.88, lon=-6.97)

    failing = httpx.Client(transport=httpx.MockTransport(lambda _request: httpx.Response(503)))
    down = Geocoder(tmp_path / "other.json", failing, delay_s=0)
    assert down.portal("CALLE MAYOR", "2") is None
    assert "CALLE MAYOR|2" not in down.cache

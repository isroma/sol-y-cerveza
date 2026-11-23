from pathlib import Path

import pytest

from solycerveza.price_extract import FoundPrice, extract_prices, prices_in
from solycerveza.websites import parse_html

FIXTURES = Path(__file__).parent / "fixtures" / "websites"


def found(lines: list[str]) -> list[tuple[str, str | None, int]]:
    return [(p.item, p.brand, p.cents) for p in extract_prices(lines)]


@pytest.mark.parametrize(
    ("line", "expected"),
    [
        # Cañas, in the many ways menus write them
        ("Caña 1,50 €", [("cana", None, 150)]),
        ("CAÑA ........ 1.50", [("cana", None, 150)]),
        ("Caña.................1.30", [("cana", None, 130)]),
        ("Caña\t1'40", [("cana", None, 140)]),
        ("Caña 1\u201950 €", [("cana", None, 150)]),
        ("Caña de cerveza \u2013 1,20€", [("cana", None, 120)]),
        ("Cañas 2 €", [("cana", None, 200)]),
        ("Caña con tapa: €1,80", [("cana", None, 180)]),
        ("Caña Cruzcampo 1,30 €", [("cana", None, 130)]),
        ("Caña 1,50 € · Copa de vino 2,00 €", [("cana", None, 150)]),
        # Tercios by brand
        ("Tercio Mahou 2,20", [("tercio", "mahou-5-estrellas", 220)]),
        ("Tercio de Mahou 5 Estrellas\t2,20 €", [("tercio", "mahou-5-estrellas", 220)]),
        ("Tercio Estrella Galicia 2'50€", [("tercio", "estrella-galicia", 250)]),
        ("Alhambra Especial 33 cl ... 2,40", [("tercio", "alhambra-especial", 240)]),
        ("Tercio Super Bock 2.00 €", [("tercio", "super-bock", 200)]),
        ("Tercio Cruz Campo 1,90", [("tercio", "cruzcampo", 190)]),
        ("Tercios: Sagres 2,10 € | Heineken 2,30 €", [("tercio", "sagres", 210)]),
        # Not a caña or a branded tercio
        ("Quinto Mahou 1,20", []),
        ("Botellín Cruzcampo 1,40 €", []),
        ("Doble 2,50", []),
        ("Jarra 3,50 €", []),
        ("Pinta Guinness 4,50 €", []),
        ("Caña / Doble 1,50 / 2,50", []),
        ("Caña sin alcohol 1,60 €", []),
        ("Caña con limón 1,60 €", []),
        ("Tercio Mahou Sin 2,20 €", []),
        ("Tercio Heineken 0,0 2,30 €", []),
        ("Tercio Alhambra Reserva 1925 2,80 €", []),
        ("Tercio Estrella Galicia 1906 2,60 €", []),
        ("Tercio 2,20 €", []),  # no brand
        ("Tercio Mahou o Cruzcampo 2,20 €", []),  # two brands
        ("Mahou 2,20 €", []),  # draught or bottle? no heading says
        ("Cerveza 1,50 €", []),
        # Food, wine and other numbers
        ("Tercio de ibérico ........ 9,50 €", []),
        ("Caña de lomo ibérico 12,00 €", []),
        ("Copa de Ribera del Duero 2,80", []),
        ("Tinto de verano 2,00 €", []),
        ("Reservas: 924 22 33 44", []),
        ("Caña de Mahou y tapa desde 2009", []),
        ("Caña 1,50 € y doble 2,50 €", []),
        ("Caña 1,50 € 1,80 € en terraza", []),
        ("Caña 1,5", []),  # one decimal and no euro sign: too vague
        ("Caña 25 cl 1,60 €", []),
        ("Caña 0,40 €", []),  # below 0,50 €
        ("Caña 16,00 €", []),  # above 15 €
        ("Happy hour: caña 1,00 €", []),
        ("Menú del día con caña 12,50 €", []),
        ("Tercio Mahou (5,5% vol)", []),
        ("Abierto de 12.30 a 16.00", []),
    ],
)
def test_lines(line: str, expected: list[tuple[str, str | None, int]]) -> None:
    assert found([line]) == expected


def test_a_tercio_heading_makes_brand_lines_tercios_until_the_next_heading() -> None:
    lines = [
        "Tercios",
        "Mahou 5 Estrellas\t2,20 €",
        "Estrella Galicia\t2,40 €",
        "Cervezas de importación",
        "Sagres\t2,00 €",
    ]
    assert found(lines) == [
        ("tercio", "mahou-5-estrellas", 220),
        ("tercio", "estrella-galicia", 240),
    ]


def test_snippet_is_the_segment_with_whitespace_collapsed() -> None:
    [price] = extract_prices(["Bebidas  ·  Caña\t\t1,50 €  ·  Café 1,20 €"])
    assert price == FoundPrice(item="cana", brand=None, cents=150, snippet="Caña 1,50 €")


def test_duplicates_on_a_page_are_kept_once() -> None:
    assert found(["Caña 1,50 €", "Caña 1,50 €"]) == [("cana", None, 150)]


def test_long_prose_is_ignored() -> None:
    prose = "En nuestra terraza " + "disfruta del mejor ambiente " * 8 + "con una caña a 1,50 €"
    assert found([prose]) == []


@pytest.mark.parametrize(
    ("segment", "valid", "pricey"),
    [
        ("1,50 €", [150], 1),
        ("€ 2", [200], 1),
        ("2,5€", [250], 1),
        ("2,5", [], 1),
        ("33 cl", [], 0),
        ("4,8 %", [], 0),
        ("924 22 33 44", [], 0),
        ("924.22.33.44", [], 0),
        ("2024", [], 0),
        ("1.500 €", [], 0),
    ],
)
def test_prices_in(segment: str, valid: list[int], pricey: int) -> None:
    assert prices_in(segment) == (valid, pricey)


def test_table_page() -> None:
    lines, _ = parse_html(
        (FIXTURES / "carta_tabla.html").read_text(encoding="utf-8"), "https://x.es/"
    )
    prices = extract_prices(lines)
    assert [(p.item, p.brand, p.cents, p.snippet) for p in prices] == [
        ("cana", None, 150, "Caña 1,50"),
        ("tercio", "mahou-5-estrellas", 220, "Tercio Mahou 5 Estrellas 2,20 €"),
    ]


def test_definition_list_page() -> None:
    lines, _ = parse_html((FIXTURES / "carta_dl.html").read_text(encoding="utf-8"), "https://x.es/")
    assert found(lines) == [
        ("tercio", "estrella-galicia", 230),
        ("tercio", "super-bock", 210),
        ("cana", None, 130),
    ]

from datetime import date
from pathlib import Path

import pytest

from solycerveza.prices import PRICES_CSV, VenuePrice, prices_by_venue, read_prices

HEADER = "venue_id,item,brand,cents,seen\n"


def test_shipped_prices_are_valid() -> None:
    read_prices(PRICES_CSV)


def test_read_prices_parses_canas_and_tercios(tmp_path: Path) -> None:
    path = tmp_path / "prices.csv"
    path.write_text(
        HEADER
        + "osm:node/1,cana,,150,2026-11-23\n"
        + "osm:node/1,tercio,cruzcampo,200,2026-11-23\n",
        encoding="utf-8",
    )
    cana, tercio = read_prices(path)
    assert (cana.item, cana.brand, cana.cents) == ("cana", None, 150)
    assert (tercio.brand, tercio.seen) == ("cruzcampo", date(2026, 11, 23))


@pytest.mark.parametrize(
    ("row", "message"),
    [
        ("osm:node/1,tercio,,200,2026-11-23", "needs a brand"),
        ("osm:node/1,cana,cruzcampo,150,2026-11-23", "needs a brand"),
        ("osm:node/1,tercio,unknown,200,2026-11-23", "brand"),
        ("osm:node/1,cana,,1.5,2026-11-23", "cents"),
        ("osm:node/1,cana,,9000,2026-11-23", "cents"),
        ("osm:node/1,jarra,,300,2026-11-23", "item"),
    ],
)
def test_read_prices_rejects_bad_rows(tmp_path: Path, row: str, message: str) -> None:
    path = tmp_path / "prices.csv"
    path.write_text(HEADER + row + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=message):
        read_prices(path)


def test_read_prices_rejects_duplicates(tmp_path: Path) -> None:
    path = tmp_path / "prices.csv"
    row = "osm:node/1,cana,,150,2026-11-23\n"
    path.write_text(HEADER + row + row, encoding="utf-8")
    with pytest.raises(ValueError, match="duplicate"):
        read_prices(path)


def test_prices_by_venue_orders_and_skips_unknown_venues(
    caplog: pytest.LogCaptureFixture,
) -> None:
    day = date(2026, 11, 23)
    rows = [
        VenuePrice(
            venue_id="osm:node/1", item="tercio", brand="mahou-5-estrellas", cents=210, seen=day
        ),
        VenuePrice(venue_id="osm:node/1", item="cana", brand=None, cents=150, seen=day),
        VenuePrice(venue_id="osm:node/9", item="cana", brand=None, cents=140, seen=day),
    ]
    result = prices_by_venue(rows, {"osm:node/1"})
    assert [p.item for p in result["osm:node/1"]] == ["cana", "tercio"]
    assert "osm:node/9" not in result
    assert "osm:node/9" in caplog.text

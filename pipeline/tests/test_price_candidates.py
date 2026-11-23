import inspect
from datetime import date
from pathlib import Path

import httpx
import pytest

from solycerveza import build
from solycerveza.price_candidates import (
    CANDIDATES_CSV,
    COLUMNS,
    Candidate,
    collect,
    merge,
    read_candidates,
    write_candidates,
)
from solycerveza.websites import Fetcher

FIXTURES = Path(__file__).parent / "fixtures" / "websites"
FETCHED = date(2026, 11, 23)


def candidate(**fields: object) -> Candidate:
    base: dict[str, object] = {
        "venue_id": "osm:node/1",
        "item": "cana",
        "brand": None,
        "cents": 150,
        "source_url": "https://bar.es/carta",
        "snippet": "Caña 1,50 €",
        "seen": FETCHED,
    }
    return Candidate.model_validate(base | fields)


def test_committed_file_is_header_only() -> None:
    assert CANDIDATES_CSV.read_text(encoding="utf-8") == ",".join(COLUMNS) + "\n"
    assert read_candidates() == []


def test_round_trip_is_sorted_and_quotes_only_when_needed(tmp_path: Path) -> None:
    path = tmp_path / "c.csv"
    rows = [
        candidate(venue_id="osm:node/2", snippet='Caña, "la de siempre": 1,50 €'),
        candidate(item="tercio", brand="sagres", cents=210, snippet="Tercio Sagres 2,10 €"),
        candidate(status="dismissed"),
    ]
    write_candidates(rows, path)
    assert path.read_text(encoding="utf-8").splitlines() == [
        "venue_id,item,brand,cents,source_url,snippet,fetched,status",
        'osm:node/1,cana,,150,https://bar.es/carta,"Caña 1,50 €",2026-11-23,dismissed',
        "osm:node/1,tercio,sagres,210,https://bar.es/carta,"
        '"Tercio Sagres 2,10 €",2026-11-23,pending',
        "osm:node/2,cana,,150,https://bar.es/carta,"
        '"Caña, ""la de siempre"": 1,50 €",2026-11-23,pending',
    ]
    assert read_candidates(path) == sorted(rows, key=lambda c: c.venue_id + c.item)


@pytest.mark.parametrize(
    ("row", "error"),
    [
        ('osm:node/1,tercio,,220,https://b.es/,"T 2,20",2026-11-23,pending', "a tercio needs"),
        ("osm:node/1,cana,,9000,https://b.es/,C,2026-11-23,pending", "cents"),
        ("osm:node/1,cana,,150,https://b.es/,C,2026-11-23,maybe", "status"),
        ("osm:node/1,cana,,150,ftp://b.es/,C,2026-11-23,pending", "source_url"),
        ("osm:node/1,cana,,150,https://b.es/,C 1,50,2026-11-23,pending", "more cells"),
    ],
)
def test_bad_rows_fail_loudly(tmp_path: Path, row: str, error: str) -> None:
    path = tmp_path / "c.csv"
    path.write_text(",".join(COLUMNS) + "\n" + row + "\n", encoding="utf-8")
    with pytest.raises(ValueError, match=error):
        read_candidates(path)


def test_merge_keeps_decisions_and_unrefreshed_venues() -> None:
    old = [
        candidate(status="dismissed"),
        candidate(cents=140, status="accepted"),
        candidate(venue_id="osm:node/9", status="pending"),
    ]
    new = [
        candidate(snippet="Caña 1,50"),  # the same price on the same page: still dismissed
        candidate(cents=160),  # a new price
    ]
    merged = merge(old, new, refreshed={"osm:node/1"})
    assert [(c.venue_id, c.cents, c.status) for c in merged] == [
        ("osm:node/1", 150, "dismissed"),
        ("osm:node/1", 160, "pending"),
        ("osm:node/9", 150, "pending"),
    ]


def test_collect_reads_prices_from_the_fixture_pages(tmp_path: Path) -> None:
    pages = {
        "https://bar.es/": (FIXTURES / "carta_tabla.html").read_text(encoding="utf-8"),
        "https://bar.es/carta/": (FIXTURES / "carta_dl.html").read_text(encoding="utf-8"),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        html = pages.get(str(request.url))
        if html is None:
            return httpx.Response(404)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=html)

    fetcher = Fetcher(
        client=httpx.Client(transport=httpx.MockTransport(handler)),
        today=FETCHED,
        cache_dir=tmp_path,
        sleep=lambda _s: None,
    )
    found, answered, leads = collect(
        {"osm:node/1": "https://bar.es/", "osm:node/2": "https://gone.es/"}, fetcher
    )
    assert answered == {"osm:node/1"}
    assert leads == [("osm:node/1", "https://bar.es/files/carta-bebidas.pdf")]
    assert [(c.source_url, c.item, c.brand, c.cents) for c in found] == [
        ("https://bar.es/", "cana", None, 150),
        ("https://bar.es/", "tercio", "mahou-5-estrellas", 220),
        ("https://bar.es/carta/", "tercio", "estrella-galicia", 230),
        ("https://bar.es/carta/", "tercio", "super-bock", 210),
        ("https://bar.es/carta/", "cana", None, 130),
    ]
    assert all(c.seen == FETCHED and c.status == "pending" for c in found)


def test_the_build_never_reads_candidates() -> None:
    assert "price_candidates" not in inspect.getsource(build)

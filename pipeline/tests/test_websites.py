from collections.abc import Callable
from datetime import date
from pathlib import Path

import duckdb
import httpx
import pytest

from solycerveza.overture import read_websites
from solycerveza.venues import USER_AGENT
from solycerveza.websites import (
    Fetcher,
    Link,
    crawl_site,
    decode,
    is_denied,
    is_lead,
    menu_links,
    normalize_url,
    osm_websites,
    own_website,
    parse_html,
    website_targets,
)

FIXTURES = Path(__file__).parent / "fixtures" / "websites"
TODAY = date(2026, 11, 23)
HTML = {"content-type": "text/html; charset=utf-8"}


class Site:
    """A fake web: path -> response, recording every request."""

    def __init__(self, routes: dict[str, httpx.Response | Callable[[], httpx.Response]]) -> None:
        self.routes = routes
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        route = self.routes.get(str(request.url))
        if route is None:
            return httpx.Response(404)
        return route() if callable(route) else route

    @property
    def urls(self) -> list[str]:
        return [str(r.url) for r in self.requests]


class Clock:
    def __init__(self) -> None:
        self.now = 0.0
        self.slept: list[float] = []

    def __call__(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.slept.append(seconds)
        self.now += seconds


def fetcher(
    site: Site,
    tmp_path: Path,
    clock: Clock | None = None,
    *,
    refresh: bool = False,
    max_bytes: int = 1_000_000,
) -> Fetcher:
    clock = clock or Clock()
    return Fetcher(
        client=httpx.Client(transport=httpx.MockTransport(site)),
        today=TODAY,
        cache_dir=tmp_path,
        sleep=clock.sleep,
        clock=clock,
        refresh=refresh,
        max_bytes=max_bytes,
    )


def page(html: str) -> httpx.Response:
    return httpx.Response(200, headers=HTML, text=html)


HOME = """<html><body>
<a href="/carta">La carta</a> <a href="/contacto">Contacto</a>
<a href="https://www.facebook.com/bar">Facebook</a> <a href="https://otro.es/menu">Otro</a>
<a href="/docs/Carta-Bebidas.pdf">Carta (PDF)</a> <a href="/img/logo.png">Logo</a>
<p>Caña 1,50 €</p></body></html>"""


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("www.bar.es", "http://www.bar.es/"),
        ("https://bar.es/carta#bebidas", "https://bar.es/carta"),
        (" https://bar.es ", "https://bar.es/"),
        ("mailto:hola@bar.es", None),
        ("bar", None),
        ("", None),
    ],
)
def test_normalize_url(raw: str, expected: str | None) -> None:
    assert normalize_url(raw) == expected


@pytest.mark.parametrize(
    ("url", "denied"),
    [
        ("https://www.facebook.com/barpepe", True),
        ("https://m.facebook.com/barpepe", True),
        ("https://instagram.com/barpepe", True),
        ("https://www.tripadvisor.es/Restaurant_Review", True),
        ("https://maps.google.com/?cid=1", True),
        ("https://www.thefork.es/restaurante/x", True),
        ("https://www.just-eat.es/x", True),
        ("https://barpepe.es/", False),
        ("https://notfacebook.com/", False),
        ("https://barpepe.wixsite.com/bar", False),
    ],
)
def test_denylist(url: str, denied: bool) -> None:
    assert is_denied(url) is denied


def test_own_website_skips_platforms() -> None:
    urls = ["https://facebook.com/bar", "www.bar.es", "https://bar2.es"]
    assert own_website(urls) == "http://www.bar.es/"
    assert own_website(["https://instagram.com/bar"]) is None


def test_osm_websites_reads_every_website_tag() -> None:
    data = {
        "elements": [
            {"type": "node", "id": 1, "tags": {"website": "https://a.es;https://b.es"}},
            {"type": "way", "id": 2, "tags": {"contact:website": "c.es"}},
            {"type": "node", "id": 3, "tags": {"name": "Sin web"}},
        ]
    }
    assert osm_websites(data) == {
        "osm:node/1": ["https://a.es", "https://b.es"],
        "osm:way/2": ["c.es"],
    }


def test_website_targets_only_known_venues_with_an_own_site() -> None:
    candidates = {
        "osm:node/1": ["https://bar.es"],
        "osm:node/2": ["https://facebook.com/x"],
        "osm:node/3": ["https://gone.es"],
    }
    assert website_targets(candidates, {"osm:node/1", "osm:node/2"}) == {
        "osm:node/1": "https://bar.es/"
    }


def test_read_websites_from_overture(tmp_path: Path) -> None:
    path = tmp_path / "places.parquet"
    duckdb.execute(
        f"""COPY (SELECT * FROM (VALUES ('a', ['https://a.es']), ('b', []::VARCHAR[]))
        AS t(id, websites)) TO '{path}' (FORMAT parquet)"""
    )
    assert read_websites(path) == {"overture:a": ["https://a.es"]}
    old = tmp_path / "old.parquet"
    duckdb.execute(f"COPY (SELECT 'a' AS id) TO '{old}' (FORMAT parquet)")
    assert read_websites(old) == {}
    assert read_websites(tmp_path / "missing.parquet") == {}


def test_parse_html_lines_cells_and_links() -> None:
    lines, links = parse_html(
        "<head><title>T</title></head><body><script>x=1</script>"
        "<table><tr><td>Caña</td><td> 1,50 </td></tr></table>"
        "<dl><dt>Tercio</dt><dd>2 €</dd></dl><p>Hola<br>mundo</p>"
        '<a href="sub/carta.html#x">La  carta</a></body>',
        "https://bar.es/es/",
    )
    assert lines == ["Caña\t1,50", "Tercio\t2 €", "Hola", "mundo", "La carta"]
    assert links == [Link(href="https://bar.es/es/sub/carta.html", text="La carta")]


def test_decode_uses_header_then_meta_charset() -> None:
    latin = "<p>Caña</p>".encode("latin-1")
    assert decode(latin, "iso-8859-1") == "<p>Caña</p>"
    meta = b'<meta charset="iso-8859-1"><p>Ca\xf1a</p>'
    assert "Caña" in decode(meta, None)
    assert decode(b"<p>Ca\xf1a</p>", None) == "<p>Caña</p>"  # not UTF-8: cp1252


def test_menu_links_and_leads() -> None:
    _, links = parse_html(HOME, "https://www.bar.es/")
    assert menu_links(links, "bar.es") == ["https://www.bar.es/carta"]
    assert [link.href for link in links if is_lead(link)] == [
        "https://www.bar.es/docs/Carta-Bebidas.pdf"
    ]


def test_crawl_fetches_home_and_menu_pages_politely(tmp_path: Path) -> None:
    site = Site(
        {
            "https://www.bar.es/robots.txt": httpx.Response(404),
            "https://www.bar.es/": page(HOME),
            "https://www.bar.es/carta": page('<p>Tercio Mahou 2,20 €</p><a href="m.pdf">menu</a>'),
        }
    )
    clock = Clock()
    result = crawl_site(fetcher(site, tmp_path, clock), "https://www.bar.es/")
    assert [p.url for p in result.pages] == ["https://www.bar.es/", "https://www.bar.es/carta"]
    assert result.leads == ["https://www.bar.es/docs/Carta-Bebidas.pdf", "https://www.bar.es/m.pdf"]
    # Only the site itself; never the PDF, the image, Facebook or the other domain.
    assert site.urls == [
        "https://www.bar.es/robots.txt",
        "https://www.bar.es/",
        "https://www.bar.es/carta",
    ]
    assert all(r.headers["User-Agent"] == USER_AGENT for r in site.requests)
    assert clock.slept == [2.0, 2.0]  # one request at a time, 2 s apart on one host


def test_cached_pages_need_no_network(tmp_path: Path) -> None:
    routes: dict[str, httpx.Response | Callable[[], httpx.Response]] = {
        "https://bar.es/robots.txt": httpx.Response(404),
        "https://bar.es/": page("<p>Caña 1,50 €</p>"),
    }
    first = Site(routes)
    crawl_site(fetcher(first, tmp_path), "https://bar.es/")
    second = Site(routes)
    result = crawl_site(fetcher(second, tmp_path), "https://bar.es/")
    assert second.requests == []
    assert result.pages[0].fetched == TODAY
    third = Site(routes)
    crawl_site(fetcher(third, tmp_path, refresh=True), "https://bar.es/")
    assert len(third.requests) == 2


def test_robots_disallow_is_honoured(tmp_path: Path) -> None:
    site = Site(
        {
            "https://bar.es/robots.txt": httpx.Response(
                200, text="User-agent: sol-y-cerveza-pipeline\nDisallow: /\n"
            ),
            "https://bar.es/": page("<p>Caña 1,50 €</p>"),
        }
    )
    assert crawl_site(fetcher(site, tmp_path), "https://bar.es/").pages == []
    assert site.urls == ["https://bar.es/robots.txt"]


def test_robots_disallowing_a_path_skips_only_that_path(tmp_path: Path) -> None:
    site = Site(
        {
            "https://bar.es/robots.txt": httpx.Response(
                200, text="User-agent: *\nDisallow: /carta\nCrawl-delay: 10\n"
            ),
            "https://bar.es/": page('<a href="/carta">Carta</a>'),
        }
    )
    clock = Clock()
    result = crawl_site(fetcher(site, tmp_path, clock), "https://bar.es/")
    assert [p.url for p in result.pages] == ["https://bar.es/"]
    assert "https://bar.es/carta" not in site.urls
    assert clock.slept == [10.0]  # the Crawl-delay wins over our 2 s


@pytest.mark.parametrize("answer", [httpx.Response(503), httpx.ConnectTimeout("slow")])
def test_unreachable_robots_means_keep_out(
    tmp_path: Path, answer: httpx.Response | Exception
) -> None:
    def robots() -> httpx.Response:
        if isinstance(answer, Exception):
            raise answer
        return answer

    site = Site({"https://bar.es/robots.txt": robots, "https://bar.es/": page("<p>x</p>")})
    assert crawl_site(fetcher(site, tmp_path), "https://bar.es/").pages == []
    assert site.urls == ["https://bar.es/robots.txt"]


def test_robots_redirect_is_followed(tmp_path: Path) -> None:
    site = Site(
        {
            "http://bar.es/robots.txt": httpx.Response(
                301, headers={"location": "https://bar.es/robots.txt"}
            ),
            "https://bar.es/robots.txt": httpx.Response(200, text="User-agent: *\nDisallow: /\n"),
            "http://bar.es/": page("<p>x</p>"),
        }
    )
    assert crawl_site(fetcher(site, tmp_path), "http://bar.es/").pages == []
    assert "http://bar.es/" not in site.urls


def test_redirects_stay_on_the_site(tmp_path: Path) -> None:
    site = Site(
        {
            "http://bar.es/robots.txt": httpx.Response(404),
            "http://bar.es/": httpx.Response(301, headers={"location": "https://www.bar.es/"}),
            "https://www.bar.es/robots.txt": httpx.Response(404),
            "https://www.bar.es/": page("<p>Caña 1,50 €</p>"),
            "http://moved.es/robots.txt": httpx.Response(404),
            "http://moved.es/": httpx.Response(
                302, headers={"location": "https://www.facebook.com/moved"}
            ),
        }
    )
    result = crawl_site(fetcher(site, tmp_path), "http://bar.es/")
    assert [p.url for p in result.pages] == ["https://www.bar.es/"]
    assert crawl_site(fetcher(site, tmp_path), "http://moved.es/").pages == []
    assert not any("facebook" in url for url in site.urls)


def test_non_html_and_errors_are_skipped(tmp_path: Path) -> None:
    site = Site(
        {
            "https://bar.es/robots.txt": httpx.Response(404),
            "https://bar.es/": httpx.Response(
                200, headers={"content-type": "application/pdf"}, content=b"%PDF-1.7"
            ),
            "https://cafe.es/robots.txt": httpx.Response(404),
            "https://cafe.es/": httpx.Response(500),
        }
    )
    assert crawl_site(fetcher(site, tmp_path), "https://bar.es/").pages == []
    assert crawl_site(fetcher(site, tmp_path), "https://cafe.es/").pages == []


def test_size_and_page_caps(tmp_path: Path) -> None:
    links = "".join(f'<a href="/carta{i}">Carta {i}</a>' for i in range(10))
    routes: dict[str, httpx.Response | Callable[[], httpx.Response]] = {
        "https://bar.es/robots.txt": httpx.Response(404),
        "https://bar.es/": page(links + "<p>" + "x" * 5000 + "</p>"),
    }
    for i in range(10):
        routes[f"https://bar.es/carta{i}"] = page(f"<p>Carta {i}</p>")
    site = Site(routes)
    result = crawl_site(fetcher(site, tmp_path, max_bytes=2000), "https://bar.es/", max_pages=3)
    assert len(result.pages) == 3
    assert len(result.pages[0].html) <= 2000
    assert len(site.requests) == 4  # robots.txt and three pages


def test_network_failures_are_not_cached(tmp_path: Path) -> None:
    def down() -> httpx.Response:
        raise httpx.ConnectError("down")

    crawl_site(fetcher(Site({"https://bar.es/robots.txt": down}), tmp_path), "https://bar.es/")
    assert list(tmp_path.iterdir()) == []

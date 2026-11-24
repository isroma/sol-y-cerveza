"""Venues' own websites: where their URLs come from, and polite fetching of a few pages each.

Only a venue's own site is fetched (ADR-0006). URLs come from OSM (`website`,
`contact:website`, `url`) and Overture (`websites`); links to social networks, review sites,
maps and delivery or booking platforms are dropped by an explicit host denylist (`DENIED_HOSTS`).

Per site, `crawl_site` fetches the home page and up to `MAX_PAGES - 1` same-site pages linked
from it whose link text or address looks like a menu (`MENU_WORDS`). It is polite:
- the pipeline's User-Agent, and robots.txt honoured (Crawl-delay too, up to `MAX_DELAY_S`);
  a robots.txt that answers 5xx or not at all means "keep out";
- one request at a time, at least `delay_s` between requests to the same host;
- timeouts, at most `MAX_BYTES` per response, redirects followed by hand (each hop is checked
  against the denylist, the site and robots.txt);
- HTML only. Menus published as PDF or image files are never downloaded: their links are
  returned as leads for the owner to read by hand.

Every answer except network failures and 5xx errors (both usually transient) is cached in
`.cache/websites/`, one JSON file per URL, so re-running the extraction needs no network. A cached
robots.txt is fetched again once it is `ROBOTS_MAX_AGE` old, so a site's new rules are seen. Only
`Fetcher` touches the network.
"""

import hashlib
import json
import logging
import re
import time
import unicodedata
import urllib.robotparser
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from datetime import date, timedelta
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import urldefrag, urljoin, urlsplit

import httpx

from solycerveza.venues import CACHE_DIR, USER_AGENT

logger = logging.getLogger(__name__)

WEBSITE_CACHE = CACHE_DIR / "websites"
# The product token robots.txt groups are matched against.
ROBOTS_AGENT = "sol-y-cerveza-pipeline"
OSM_WEBSITE_TAGS = ("website", "contact:website", "url")
MAX_PAGES = 5  # the home page and up to four menu pages per site
MAX_BYTES = 1_000_000
MAX_REDIRECTS = 3
DEFAULT_DELAY_S = 2.0
MAX_DELAY_S = 30.0
TIMEOUT = httpx.Timeout(15.0, connect=10.0)
# A cached robots.txt older than this is fetched again.
ROBOTS_MAX_AGE = timedelta(days=30)

# Platforms that are not the venue's own site: their terms forbid scraping, or the page is a
# profile on someone else's service. A host matches when it equals an entry or ends with
# "." + entry.
DENIED_HOSTS = frozenset(
    {
        # Social networks and link pages
        "facebook.com",
        "fb.com",
        "fb.me",
        "instagram.com",
        "twitter.com",
        "x.com",
        "tiktok.com",
        "youtube.com",
        "youtu.be",
        "linkedin.com",
        "pinterest.com",
        "linktr.ee",
        "wa.me",
        "whatsapp.com",
        "t.me",
        # Search, maps and reviews
        "google.com",
        "google.es",
        "goo.gl",
        "g.page",
        "business.site",
        "tripadvisor.com",
        "tripadvisor.es",
        "tripadvisor.co.uk",
        "yelp.com",
        "yelp.es",
        "foursquare.com",
        "restaurantguru.com",
        "restaurantguru.es",
        "michelin.com",
        # Booking and delivery platforms
        "thefork.com",
        "thefork.es",
        "eltenedor.es",
        "covermanager.com",
        "booking.com",
        "just-eat.es",
        "justeat.es",
        "glovoapp.com",
        "ubereats.com",
        "deliveroo.es",
    }
)
# Link text or address of a page that may hold the drinks list (accent-free, lower case).
MENU_WORDS = re.compile(r"carta|menu|bebidas|precios|drinks")
# Files that are menus but not HTML: recorded as leads, never downloaded.
LEAD_SUFFIXES = (".pdf", ".jpg", ".jpeg", ".png", ".webp")
HTML_TYPES = ("text/html", "application/xhtml+xml")


def plain(text: str) -> str:
    """Lower case without accents (ñ becomes n), for matching words."""
    decomposed = unicodedata.normalize("NFKD", text.lower())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


def normalize_url(raw: str) -> str | None:
    """An absolute http(s) URL without fragment, or None if `raw` is not a usable web address."""
    text = raw.strip()
    if not text or " " in text:
        return None
    if re.match(r"^[a-z][a-z0-9+.-]*:(?!//)", text, re.IGNORECASE):
        return None  # mailto:, tel:, javascript:...
    if "://" not in text:
        text = "http://" + text.removeprefix("//")
    url, _ = urldefrag(text)
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname or "." not in parts.hostname:
        return None
    if parts.username is not None:
        return None
    if not parts.path:
        url += "/"
    return url


def host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower().rstrip(".")


def site_of(url: str) -> str:
    """The host without a leading "www.": www.bar.es and bar.es are one site."""
    return host_of(url).removeprefix("www.")


def is_denied(url: str) -> bool:
    host = host_of(url)
    return any(host == denied or host.endswith("." + denied) for denied in DENIED_HOSTS)


def own_website(urls: Iterable[str]) -> str | None:
    """The first of `urls` that is a usable address of the venue's own site."""
    for raw in urls:
        url = normalize_url(raw)
        if url is not None and not is_denied(url):
            return url
    return None


def osm_websites(data: Mapping[str, Any]) -> dict[str, list[str]]:
    """Venue id -> website tags of each element of an Overpass response, in tag order."""
    result: dict[str, list[str]] = {}
    for element in data.get("elements", []):
        tags = element.get("tags") or {}
        urls = [
            part.strip()
            for tag in OSM_WEBSITE_TAGS
            for part in str(tags.get(tag, "")).split(";")
            if part.strip()
        ]
        if urls and element.get("type") in ("node", "way"):
            result[f"osm:{element['type']}/{element['id']}"] = urls
    return result


def website_targets(
    candidates: Mapping[str, Iterable[str]], known: Iterable[str]
) -> dict[str, str]:
    """Venue id -> own website, for the `known` venues that have one, sorted by id."""
    wanted = set(known)
    targets: dict[str, str] = {}
    for venue_id in sorted(candidates):
        if venue_id not in wanted:
            continue
        url = own_website(candidates[venue_id])
        if url is not None:
            targets[venue_id] = url
    return targets


# --- HTML to text -------------------------------------------------------------------------

BLOCK_TAGS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "br",
        "caption",
        "div",
        "dl",
        "dt",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tbody",
        "thead",
        "tfoot",
        "tr",
        "ul",
    }
)
CELL_TAGS = frozenset({"td", "th", "dd"})
SKIPPED_TAGS = frozenset({"script", "style", "noscript", "svg", "template", "head", "iframe"})


@dataclass(frozen=True)
class Link:
    href: str  # absolute
    text: str


class _TextParser(HTMLParser):
    def __init__(self, base_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.parts: list[str] = []
        self.links: list[Link] = []
        self._skip = 0
        self._href: str | None = None
        self._link_text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIPPED_TAGS:
            self._skip += 1
        elif tag == "base":
            href = dict(attrs).get("href")
            if href:
                self.base_url = urljoin(self.base_url, href)
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")
        elif tag in CELL_TAGS:
            self.parts.append("\t")
        if tag == "a":
            href = dict(attrs).get("href")
            self._href = urljoin(self.base_url, href) if href else None
            self._link_text = []

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIPPED_TAGS:
            self._skip = max(0, self._skip - 1)
        elif tag in BLOCK_TAGS and tag != "dt":
            self.parts.append("\n")
        if tag == "a" and self._href is not None:
            text = " ".join("".join(self._link_text).split())
            self.links.append(Link(href=urldefrag(self._href)[0], text=text))
            self._href = None

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        self.parts.append(data)
        if self._href is not None:
            self._link_text.append(data)


def parse_html(html: str, base_url: str) -> tuple[list[str], list[Link]]:
    """The page's visible text as lines (table cells and definitions joined by tabs), and links.

    Lines follow block elements; inside a line, runs of whitespace become one space.
    """
    parser = _TextParser(base_url)
    parser.feed(html)
    parser.close()
    lines: list[str] = []
    for raw in "".join(parser.parts).split("\n"):
        cells = [" ".join(cell.split()) for cell in raw.split("\t")]
        line = "\t".join(cell for cell in cells if cell)
        if line:
            lines.append(line)
    return lines, parser.links


def decode(body: bytes, header_charset: str | None) -> str:
    """Text of an HTML body: the header's charset, else a <meta> charset, else UTF-8 or cp1252."""
    meta = re.search(rb"""<meta[^>]+charset=["']?([\w-]+)""", body[:4096], re.IGNORECASE)
    for charset in (header_charset, meta.group(1).decode("ascii") if meta else None):
        if charset:
            try:
                return body.decode(charset, errors="replace")
            except LookupError:
                continue
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", errors="replace")


# --- Fetching -----------------------------------------------------------------------------


@dataclass(frozen=True)
class Response:
    """A cached response: status, type, redirect target and (for HTML) the decoded body."""

    url: str
    status: int  # 0 when the request failed (timeout, DNS, TLS...)
    content_type: str
    location: str | None
    fetched: date
    body: str


@dataclass(frozen=True)
class Page:
    url: str  # after redirects
    fetched: date
    html: str


def cache_file(cache_dir: Path, url: str) -> Path:
    return cache_dir / f"{hashlib.sha256(url.encode()).hexdigest()[:24]}.json"


def is_robots(url: str) -> bool:
    return urlsplit(url).path == "/robots.txt"


def is_cacheable(status: int) -> bool:
    """An answer worth keeping: not a network failure (0) or a server error (5xx)."""
    return 0 < status < 500


@dataclass
class Fetcher:
    """One request at a time, cached, with robots.txt and a per-host delay."""

    client: httpx.Client
    today: date
    cache_dir: Path = WEBSITE_CACHE
    refresh: bool = False
    delay_s: float = DEFAULT_DELAY_S
    max_bytes: int = MAX_BYTES
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic
    requests: int = 0
    _last: dict[str, float] = field(default_factory=dict)
    _robots: dict[str, urllib.robotparser.RobotFileParser | None] = field(default_factory=dict)
    _delays: dict[str, float] = field(default_factory=dict)

    def response(self, url: str) -> Response:
        """The response for `url`, from the cache or the network.

        Answers are cached; network failures and 5xx errors are not (try again next run), and a
        cached robots.txt is fetched again once it is `ROBOTS_MAX_AGE` old (by `today`).
        """
        path = cache_file(self.cache_dir, url)
        if not self.refresh and path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            cached = Response(
                url=raw["url"],
                status=raw["status"],
                content_type=raw["content_type"],
                location=raw["location"],
                fetched=date.fromisoformat(raw["fetched"]),
                body=raw["body"],
            )
            stale = is_robots(url) and self.today - cached.fetched >= ROBOTS_MAX_AGE
            # A 5xx cached by an older version is not an answer either.
            if is_cacheable(cached.status) and not stale:
                return cached
        response = self._download(url)
        if not is_cacheable(response.status):
            return response
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "url": response.url,
            "status": response.status,
            "content_type": response.content_type,
            "location": response.location,
            "fetched": response.fetched.isoformat(),
            "body": response.body,
        }
        partial = path.with_suffix(".part")
        partial.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
        partial.replace(path)
        return response

    def _wait(self, host: str) -> None:
        delay = self._delays.get(host, self.delay_s)
        last = self._last.get(host)
        if last is not None:
            remaining = delay - (self.clock() - last)
            if remaining > 0:
                self.sleep(remaining)

    def _download(self, url: str) -> Response:
        host = host_of(url)
        self._wait(host)
        self.requests += 1
        failed = Response(url, 0, "", None, self.today, "")
        try:
            with self.client.stream(
                "GET", url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT
            ) as answer:
                content_type = answer.headers.get("content-type", "").split(";")[0].strip()
                location = answer.headers.get("location")
                body = b""
                if answer.status_code == 200 and (
                    content_type in HTML_TYPES or url.endswith("/robots.txt")
                ):
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in answer.iter_bytes():
                        chunks.append(chunk)
                        size += len(chunk)
                        if size >= self.max_bytes:
                            logger.info("%s: cut at %d bytes", url, self.max_bytes)
                            break
                    body = b"".join(chunks)[: self.max_bytes]
                text = decode(body, answer.charset_encoding) if body else ""
                return Response(url, answer.status_code, content_type, location, self.today, text)
        except httpx.HTTPError as error:
            logger.info("%s: %r", url, error)
            return failed
        finally:
            self._last[host] = self.clock()

    def allowed(self, url: str) -> bool:
        """Whether robots.txt lets us fetch `url` (fetching robots.txt once per host)."""
        parts = urlsplit(url)
        origin = f"{parts.scheme}://{parts.netloc}"
        if origin not in self._robots:
            robots_url = origin + "/robots.txt"
            answer = self.response(robots_url)
            for _ in range(MAX_REDIRECTS):  # e.g. http -> https, or to the www. host
                if answer.status not in (301, 302, 303, 307, 308) or not answer.location:
                    break
                robots_url = urljoin(robots_url, answer.location)
                if is_denied(robots_url) or site_of(robots_url) != site_of(url):
                    break
                answer = self.response(robots_url)
            parser: urllib.robotparser.RobotFileParser | None
            if answer.status == 200:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(answer.body.splitlines())
                crawl_delay = parser.crawl_delay(ROBOTS_AGENT)
                if crawl_delay is not None:
                    self._delays[host_of(url)] = min(
                        max(float(crawl_delay), self.delay_s), MAX_DELAY_S
                    )
            elif 400 <= answer.status < 500:
                parser = None  # no robots.txt: everything is allowed
            else:
                parser = urllib.robotparser.RobotFileParser()
                parser.parse(["User-agent: *", "Disallow: /"])  # unreachable: stay out
            self._robots[origin] = parser
        robots = self._robots[origin]
        return robots is None or robots.can_fetch(ROBOTS_AGENT, url)

    def page(self, url: str, site: str) -> Page | None:
        """The HTML page at `url`, following redirects that stay on `site`; None otherwise."""
        for _ in range(MAX_REDIRECTS + 1):
            if is_denied(url) or site_of(url) != site:
                logger.info("%s: leaves %s, skipped", url, site)
                return None
            if not self.allowed(url):
                logger.info("%s: disallowed by robots.txt", url)
                return None
            answer = self.response(url)
            if answer.status in (301, 302, 303, 307, 308) and answer.location:
                url = normalize_url(urljoin(url, answer.location)) or ""
                continue
            if answer.status == 200 and answer.content_type in HTML_TYPES:
                return Page(url=url, fetched=answer.fetched, html=answer.body)
            logger.info("%s: HTTP %d %s, skipped", url, answer.status, answer.content_type)
            return None
        logger.info("%s: too many redirects", url)
        return None


def is_lead(link: Link) -> bool:
    """A link to a menu published as a PDF or an image."""
    path = urlsplit(link.href).path.lower()
    return path.endswith(LEAD_SUFFIXES) and bool(MENU_WORDS.search(plain(f"{link.text} {path}")))


def menu_links(links: Iterable[Link], site: str) -> list[str]:
    """Same-site HTML pages whose link text or address looks like a menu, in page order."""
    seen: list[str] = []
    for link in links:
        url = normalize_url(link.href)
        if url is None or site_of(url) != site or is_lead(link):
            continue
        if urlsplit(url).path.lower().endswith(LEAD_SUFFIXES):
            continue
        if MENU_WORDS.search(plain(f"{link.text} {urlsplit(url).path}")) and url not in seen:
            seen.append(url)
    return seen


@dataclass(frozen=True)
class SiteResult:
    pages: list[Page]
    leads: list[str]  # menu PDFs or images linked from the pages


def crawl_site(fetcher: Fetcher, url: str, max_pages: int = MAX_PAGES) -> SiteResult:
    """The home page at `url` plus its menu pages (one level deep), and menu file leads."""
    site = site_of(url)
    home = fetcher.page(url, site)
    if home is None:
        return SiteResult(pages=[], leads=[])
    pages = [home]
    _, links = parse_html(home.html, home.url)
    leads = [link.href for link in links if is_lead(link)]
    for link in menu_links(links, site):
        if len(pages) >= max_pages:
            break
        if any(p.url == link for p in pages):
            continue
        page = fetcher.page(link, site)
        if page is not None and all(p.url != page.url for p in pages):
            pages.append(page)
            _, more = parse_html(page.html, page.url)
            leads += [m.href for m in more if is_lead(m)]
    return SiteResult(pages=pages, leads=sorted(set(leads)))

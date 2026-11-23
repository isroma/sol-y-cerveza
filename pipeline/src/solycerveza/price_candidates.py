"""Beer price candidates from venues' own websites, for the owner to approve (ADR-0006).

`python -m solycerveza.price_candidates [--refresh]` fetches each venue's own website
(`solycerveza.websites`, cached in `.cache/websites/`), extracts caña and tercio prices
(`solycerveza.price_extract`) and writes them to `pipeline/data/price_candidates.csv`. Menu
PDFs and images it finds but does not read are listed in `.cache/menu_leads.csv`.

These are not prices: the build never reads this file. The owner accepts a candidate in the
admin, which copies it into `venue_prices.csv`, or dismisses it. Either way its `status`
remembers the decision, so the next run does not offer it again.

`price_candidates.csv` (UTF-8, header required, sorted by venue, item, brand, cents and URL)
has one row per venue, item, brand, price and source page:

- `venue_id`, `item`, `brand`, `cents`: as in `venue_prices.csv`.
- `source_url`: the page the price was read on.
- `snippet`: the text it was read from, whitespace collapsed, at most 160 characters.
- `fetched`: YYYY-MM-DD of when the page was downloaded.
- `status`: `pending`, `accepted` or `dismissed`.
"""

import argparse
import csv
import logging
from collections.abc import Iterable, Sequence
from datetime import date
from pathlib import Path
from typing import Annotated, Literal

import httpx
from pydantic import Field, ValidationError

from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.overture import cache_path, read_websites
from solycerveza.price_extract import MAX_SNIPPET, extract_prices
from solycerveza.prices import Price
from solycerveza.review import read_review, review_venues
from solycerveza.sources import load_all_venues
from solycerveza.venues import CACHE_DIR, VENUE_ID_PATTERN, build_query, cached_overpass
from solycerveza.websites import (
    WEBSITE_CACHE,
    Fetcher,
    crawl_site,
    osm_websites,
    parse_html,
    website_targets,
)

logger = logging.getLogger(__name__)

CANDIDATES_CSV = Path(__file__).resolve().parents[2] / "data" / "price_candidates.csv"
LEADS_CSV = CACHE_DIR / "menu_leads.csv"
COLUMNS = ("venue_id", "item", "brand", "cents", "source_url", "snippet", "fetched", "status")

Status = Literal["pending", "accepted", "dismissed"]


class Candidate(Price):
    """A row of `price_candidates.csv`: a price read on a venue's website, and its decision."""

    venue_id: Annotated[str, Field(pattern=VENUE_ID_PATTERN)]
    source_url: Annotated[str, Field(pattern=r"^https?://")]
    snippet: Annotated[str, Field(min_length=1, max_length=MAX_SNIPPET)]
    status: Status = "pending"

    @property
    def key(self) -> tuple[str, str, str, int, str]:
        return (self.venue_id, self.item, self.brand or "", self.cents, self.source_url)


def sort_key(c: Candidate) -> tuple[str, str, str, int, str, str]:
    return (*c.key, c.snippet)


def read_candidates(path: Path = CANDIDATES_CSV) -> list[Candidate]:
    """The candidate rows, or none when the file does not exist yet."""
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) != COLUMNS:
            raise ValueError(f"{path}: header must be {','.join(COLUMNS)}")
        rows: list[Candidate] = []
        for row in reader:
            if None in row:
                raise ValueError(f"{path}:{reader.line_num}: more cells than columns")
            cells = {k: (v or "").strip() or None for k, v in row.items()}
            cells["seen"] = cells.pop("fetched")
            try:
                rows.append(Candidate.model_validate(cells))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    return rows


def write_candidates(rows: Iterable[Candidate], path: Path = CANDIDATES_CSV) -> None:
    """Write the rows sorted, with "\\n" line ends, quoting only where CSV needs it."""
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(COLUMNS)
        for c in sorted(rows, key=sort_key):
            writer.writerow(
                [
                    c.venue_id,
                    c.item,
                    c.brand or "",
                    c.cents,
                    c.source_url,
                    c.snippet,
                    c.seen.isoformat(),
                    c.status,
                ]
            )


def merge(
    old: Sequence[Candidate], new: Sequence[Candidate], refreshed: set[str]
) -> list[Candidate]:
    """New candidates keep the status of the same old one; venues not refreshed keep old rows.

    A candidate is the same when venue, item, brand, price and page match. One row per key.
    """
    status = {c.key: c.status for c in old}
    rows = [c for c in old if c.venue_id not in refreshed]
    rows += [c.model_copy(update={"status": status.get(c.key, "pending")}) for c in new]
    unique: dict[tuple[str, str, str, int, str], Candidate] = {}
    for c in sorted(rows, key=sort_key):
        unique.setdefault(c.key, c)
    return list(unique.values())


def write_leads(leads: Iterable[tuple[str, str]], path: Path = LEADS_CSV) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.writer(file, lineterminator="\n")
        writer.writerow(("venue_id", "url"))
        writer.writerows(sorted(set(leads)))


def known_venue_ids() -> set[str]:
    """Ids of every venue the build would list (sources, corrections and the admin's review)."""
    return {v.id for v in review_venues(load_all_venues(), read_review())}


def candidate_websites(known: set[str]) -> dict[str, str]:
    """Venue id -> own website, from the cached OSM and Overture downloads."""
    with httpx.Client(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
        overpass = cached_overpass(build_query(BADAJOZ_BBOX), CACHE_DIR, client=client)
    urls = {**read_websites(cache_path()), **osm_websites(overpass)}
    return website_targets(urls, known)


def collect(
    targets: dict[str, str], fetcher: Fetcher
) -> tuple[list[Candidate], set[str], list[tuple[str, str]]]:
    """Candidates, the venues whose site answered, and menu-file leads, for every target."""
    found: list[Candidate] = []
    answered: set[str] = set()
    leads: list[tuple[str, str]] = []
    for venue_id, url in targets.items():
        site = crawl_site(fetcher, url)
        if site.pages:
            answered.add(venue_id)
        leads += [(venue_id, lead) for lead in site.leads]
        for page in site.pages:
            lines, _ = parse_html(page.html, page.url)
            for price in extract_prices(lines):
                found.append(
                    Candidate(
                        venue_id=venue_id,
                        item=price.item,
                        brand=price.brand,
                        cents=price.cents,
                        seen=page.fetched,
                        source_url=page.url,
                        snippet=price.snippet,
                    )
                )
    return found, answered, leads


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Price candidates from venues' own websites.")
    parser.add_argument(
        "--refresh", action="store_true", help="download the pages again even if cached"
    )
    parser.add_argument(
        "--delay", type=float, default=2.0, help="seconds between requests to one host"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    targets = candidate_websites(known_venue_ids())
    logger.info("%d venues have their own website", len(targets))
    with httpx.Client(follow_redirects=False) as client:
        fetcher = Fetcher(
            client=client,
            today=date.today(),
            cache_dir=WEBSITE_CACHE,
            refresh=args.refresh,
            delay_s=args.delay,
        )
        found, answered, leads = collect(targets, fetcher)
    rows = merge(read_candidates(), found, answered)
    write_candidates(rows)
    write_leads(leads)
    pending = sum(c.status == "pending" for c in rows)
    logger.info(
        "%d of %d sites answered (%d requests); %d candidates (%d pending) -> %s; "
        "%d menu PDF/image leads -> %s",
        len(answered),
        len(targets),
        fetcher.requests,
        len(rows),
        pending,
        CANDIDATES_CSV,
        len(set(leads)),
        LEADS_CSV,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

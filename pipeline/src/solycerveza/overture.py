"""Venues from Overture Maps places, for the many bars and restaurants missing from OSM.

Overture (release pinned in RELEASE) merges places from Meta, Microsoft and others. We keep
bars, pubs, cafés, restaurants and beer gardens that are not permanently closed and have a
confidence of at least MIN_CONFIDENCE, and drop records whose sources include Foursquare
(Apache-2.0 would oblige us to ship its NOTICE file; they are a handful). The rest is
CDLA-Permissive-2.0 or CC0: compatible with our ODbL output as long as the CDLA text ships
with the data (`web/public/data/licenses/`). See ADR-0003.

Overture says nothing about terraces, so these venues never have one unless a curated row adds
it. Duplicates of OSM venues are dropped by `merge_venues`, so OSM ids win.

Run `python -m solycerveza.overture` to download the places for the bbox into `.cache/`.
"""

import argparse
import logging
import re
import unicodedata
from collections.abc import Iterable, Sequence
from difflib import SequenceMatcher
from pathlib import Path

import duckdb

from solycerveza.geo import BADAJOZ_BBOX, BoundingBox, distance_m
from solycerveza.venues import CACHE_DIR, Kind, LatLon, Venue

logger = logging.getLogger(__name__)

RELEASE = "2026-11-18.0"
PLACES = f"s3://overturemaps-us-west-2/release/{RELEASE}/theme=places/type=place/*"
MIN_CONFIDENCE = 0.6
EXCLUDED_DATASETS = frozenset({"Foursquare"})

# Overture taxonomy `primary` -> our kinds. Fast food, bakeries, ice cream, nightclubs and
# shops are left out on purpose: they rarely have the kind of terrace this app is about.
PRIMARY_KINDS: dict[str, Kind] = {
    "bar": "bar",
    "cocktail_bar": "bar",
    "beer_bar": "bar",
    "wine_bar": "bar",
    "sports_bar": "bar",
    "tapas_bar": "bar",
    "lounge": "bar",
    "brewery": "bar",
    "pub": "pub",
    "irish_pub": "pub",
    "gastropub": "pub",
    "beer_garden": "biergarten",
    "cafe": "cafe",
    "coffee_shop": "cafe",
    "tea_room": "cafe",
    "cafeteria": "cafe",
    "bistro": "restaurant",
}
NOT_VENUES = frozenset(
    {
        "fast_food_restaurant",
        "burger_restaurant",
        "chicken_restaurant",
        "hot_dog_restaurant",
        "sandwich_shop",
        "food_truck_stand",
        "doner_kebab_restaurant",
        "pizza_delivery",
    }
)


def cache_path(cache_dir: Path = CACHE_DIR) -> Path:
    return cache_dir / f"overture_places_{RELEASE}.parquet"


def fetch_places(
    bbox: BoundingBox = BADAJOZ_BBOX, cache_dir: Path = CACHE_DIR, *, source: str = PLACES
) -> Path:
    """Download the places of `bbox` from Overture's public S3 bucket into a parquet file.

    It is written to a `.part` file first and renamed when complete, because callers trust the
    file once it exists: an interrupted download must not leave a truncated cache behind.
    """
    path = cache_path(cache_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".part")
    con = duckdb.connect()
    if source.startswith("s3://"):
        con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
    con.execute(
        f"""
        COPY (
          SELECT id, names.primary AS name,
                 (bbox.xmin + bbox.xmax) / 2 AS lon, (bbox.ymin + bbox.ymax) / 2 AS lat,
                 confidence, operating_status,
                 taxonomy.primary AS category, taxonomy.hierarchy AS hierarchy,
                 list_transform(sources, lambda s: s.dataset) AS datasets,
                 websites, addresses
          FROM read_parquet('{source}', hive_partitioning = 1)
          WHERE bbox.xmin >= ? AND bbox.xmax <= ? AND bbox.ymin >= ? AND bbox.ymax <= ?
          ORDER BY id
        ) TO '{partial}' (FORMAT parquet)
        """,
        [bbox.west, bbox.east, bbox.south, bbox.north],
    )
    con.close()
    partial.replace(path)
    return path


def overture_kind(category: str | None, hierarchy: Sequence[str] | None) -> Kind | None:
    """Our kind for an Overture category, or None if it is not a venue we list."""
    if category in NOT_VENUES:
        return None
    if category in PRIMARY_KINDS:
        return PRIMARY_KINDS[category]
    path = list(hierarchy or [])
    if len(path) > 1 and path[0] == "food_and_drink" and path[1] == "restaurant":
        return "restaurant"
    return None


def read_places(path: Path) -> list[Venue]:
    """Venues from a parquet written by `fetch_places`, filtered as described above."""
    rows = duckdb.connect().execute(
        "SELECT id, name, lon, lat, confidence, operating_status, category, hierarchy, datasets "
        "FROM read_parquet(?) ORDER BY id",
        [str(path)],
    )
    venues: list[Venue] = []
    for (
        place_id,
        name,
        lon,
        lat,
        confidence,
        status,
        category,
        hierarchy,
        datasets,
    ) in rows.fetchall():
        kind = overture_kind(category, hierarchy)
        if kind is None or not name or status == "permanently_closed":
            continue
        if (confidence or 0) < MIN_CONFIDENCE or EXCLUDED_DATASETS & set(datasets or []):
            continue
        venues.append(
            Venue(
                id=f"overture:{place_id}",
                name=str(name).strip(),
                kind=kind,
                location=LatLon(lat=lat, lon=lon),
                outdoor_seating=None,
            )
        )
    return venues


def read_websites(path: Path) -> dict[str, list[str]]:
    """Venue id -> the place's `websites`, from a parquet written by `fetch_places`.

    Parquets downloaded before websites were kept have no such column: re-run
    `python -m solycerveza.overture` to get them.
    """
    if not path.exists():
        return {}
    con = duckdb.connect()
    columns = {
        row[0]
        for row in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(path)]).fetchall()
    }
    if "websites" not in columns:
        logger.warning("%s has no websites: re-run `python -m solycerveza.overture`", path)
        return {}
    rows = con.execute(
        "SELECT id, websites FROM read_parquet(?) WHERE len(websites) > 0 ORDER BY id",
        [str(path)],
    ).fetchall()
    return {f"overture:{place_id}": [str(url) for url in urls] for place_id, urls in rows}


def read_addresses(path: Path) -> dict[str, list[str]]:
    """Venue id -> the place's `addresses[].freeform` lines, from a parquet by `fetch_places`.

    Parquets downloaded before addresses were kept have no such column: re-run
    `python -m solycerveza.overture` to get them.
    """
    if not path.exists():
        return {}
    con = duckdb.connect()
    columns = {
        row[0]
        for row in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [str(path)]).fetchall()
    }
    if "addresses" not in columns:
        logger.warning("%s has no addresses: re-run `python -m solycerveza.overture`", path)
        return {}
    rows = con.execute(
        "SELECT id, list_filter(list_transform(addresses, lambda a: a.freeform), "
        "lambda f: f IS NOT NULL) FROM read_parquet(?) WHERE len(addresses) > 0 ORDER BY id",
        [str(path)],
    ).fetchall()
    return {
        f"overture:{place_id}": [str(line) for line in lines] for place_id, lines in rows if lines
    }


# Words that say what a venue is, not which one it is.
GENERIC = frozenset(
    [
        "bar",
        "cafe",
        "cafeteria",
        "restaurante",
        "restaurant",
        "cerveceria",
        "taberna",
        "meson",
        "pub",
        "tapas",
        "terraza",
        "terrazas",
        "el",
        "la",
        "los",
        "las",
        "de",
        "del",
        "y",
        "badajoz",
    ]
)


def normalize_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    words = [w for w in re.sub(r"[^a-z0-9 ]+", " ", text).split() if w not in GENERIC]
    return " ".join(words)


def name_similarity(a: str, b: str) -> float:
    """0 to 100: how alike two venue names are, ignoring accents, case and generic words."""
    na, nb = normalize_name(a), normalize_name(b)
    if not na or not nb:
        na, nb = a.lower(), b.lower()
    whole = SequenceMatcher(None, na, nb).ratio()
    tokens = SequenceMatcher(None, " ".join(sorted(na.split())), " ".join(sorted(nb.split())))
    shorter, longer = sorted((na.replace(" ", ""), nb.replace(" ", "")), key=len)
    contained = 0.9 if len(shorter) >= 5 and shorter in longer else 0.0
    return 100 * max(whole, tokens.ratio(), contained)


def same_venue(a: Venue, b: Venue) -> bool:
    """Close and alike enough to be one venue (thresholds from the research notes)."""
    if a.name is None or b.name is None:
        return False
    d = distance_m(a.location, b.location)
    if d > 250:
        return False
    s = name_similarity(a.name, b.name)
    return (d <= 25 and s >= 60) or (d <= 100 and s >= 80) or (s >= 95 and len(a.name) >= 5)


def merge_venues(osm: Iterable[Venue], overture: Iterable[Venue]) -> list[Venue]:
    """OSM venues plus the Overture venues that duplicate neither OSM nor each other."""
    kept = list(osm)
    added = 0
    for venue in overture:
        if any(same_venue(venue, other) for other in kept):
            continue
        kept.append(venue)
        added += 1
    logger.info("Overture adds %d venues to %d from OSM", added, len(kept) - added)
    return sorted(kept, key=lambda venue: venue.id)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download Overture places for Badajoz.")
    parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    path = fetch_places()
    logger.info("%d venues kept from %s", len(read_places(path)), path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

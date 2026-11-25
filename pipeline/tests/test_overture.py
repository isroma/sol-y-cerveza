import itertools
import random
from pathlib import Path

import duckdb
import pytest

from solycerveza.geo import BADAJOZ_BBOX, distance_m
from solycerveza.overture import (
    MATCH_RADIUS_M,
    NearbyVenues,
    _similar_at_least,
    cache_path,
    drop_counters,
    fetch_places,
    merge_venues,
    name_similarity,
    overture_kind,
    read_addresses,
    read_places,
    same_venue,
)
from solycerveza.venues import LatLon, Venue


def venue(venue_id: str, name: str, lat: float, lon: float) -> Venue:
    return Venue(
        id=venue_id,
        name=name,
        kind="bar",
        location=LatLon(lat=lat, lon=lon),
        outdoor_seating=None,
    )


@pytest.mark.parametrize(
    ("category", "hierarchy", "kind"),
    [
        ("tapas_bar", ["food_and_drink", "alcoholic_beverage_venue"], "bar"),
        ("gastropub", None, "pub"),
        ("coffee_shop", ["food_and_drink", "cafe"], "cafe"),
        ("beer_garden", None, "biergarten"),
        (
            "spanish_restaurant",
            ["food_and_drink", "restaurant", "spanish_restaurant"],
            "restaurant",
        ),
        ("burger_restaurant", ["food_and_drink", "restaurant"], "restaurant"),
        ("fast_food_restaurant", None, "restaurant"),
        ("pizza_delivery", ["food_and_drink", "restaurant"], None),
        ("food_truck_stand", None, None),
        ("bakery", ["food_and_drink", "bakery"], None),
        ("hotel", ["accommodation"], None),
    ],
)
def test_overture_kind(category: str, hierarchy: list[str] | None, kind: str | None) -> None:
    assert overture_kind(category, hierarchy) == kind


def test_name_similarity_ignores_accents_case_and_generic_words() -> None:
    assert name_similarity("Café Bar El Velador", "EL VELADOR") >= 95
    assert name_similarity("Cervecería La Marina", "Bar La Marina") >= 95
    assert name_similarity("Chat Noir", "Café Concierto Chatnoir") >= 80
    assert name_similarity("La Marina", "El Pilar") < 60


def test_same_venue_needs_closeness_and_a_similar_name() -> None:
    a = venue("osm:node/1", "La Marina", 38.88, -6.97)
    near_same = venue("overture:a", "Bar La Marina", 38.8801, -6.97)  # ~11 m
    near_other = venue("overture:b", "El Pilar", 38.8801, -6.97)
    far_same = venue("overture:c", "La Marina", 38.8850, -6.97)  # ~550 m
    assert same_venue(a, near_same)
    assert not same_venue(a, near_other)
    assert not same_venue(a, far_same)


NAMES = [
    "La Marina",
    "Bar La Marina",
    "Cervecería La Marina",
    "El Pilar",
    "Café Bar El Velador",
    "EL VELADOR",
    "Chat Noir",
    "Café Concierto Chatnoir",
    "Bar",
    "Pub",
    "Toro",
    "Mesón El Toro",
    "Marina 2",
    "La Mar",
]


@pytest.mark.parametrize("threshold", [0.0, 59.9, 60.0, 80.0, 90.0, 95.0, 100.0])
def test_similar_at_least_agrees_with_name_similarity(threshold: float) -> None:
    for a, b in itertools.product(NAMES, repeat=2):
        assert _similar_at_least(a, b, threshold) == (name_similarity(a, b) >= threshold), (a, b)
    # At the exact similarity, the bound must not round a pair out.
    for a, b in itertools.product(NAMES, repeat=2):
        assert _similar_at_least(a, b, name_similarity(a, b)), (a, b)


def _reference_same_venue(a: Venue, b: Venue) -> bool:
    """`same_venue` as first written, computing the similarity in full."""
    if a.name is None or b.name is None:
        return False
    d = distance_m(a.location, b.location)
    if d > 250:
        return False
    s = name_similarity(a.name, b.name)
    return (d <= 25 and s >= 60) or (d <= 100 and s >= 80) or (s >= 95 and len(a.name) >= 5)


def test_same_venue_matches_its_definition_at_every_distance_band() -> None:
    # About 0, 20, 30, 90, 110, 240 and 260 m north of the first venue.
    offsets = [0.0, 0.00018, 0.00027, 0.00081, 0.00099, 0.00216, 0.00234]
    for (a, b), dlat in itertools.product(itertools.product(NAMES, repeat=2), offsets):
        first = venue("osm:node/1", a, 38.88, -6.97)
        second = venue("overture:a", b, 38.88 + dlat, -6.97)
        assert same_venue(first, second) == _reference_same_venue(first, second), (a, b, dlat)


@pytest.mark.parametrize("lat", [38.88, -45.0, 0.0, 75.0, 89.5])
def test_nearby_venues_finds_every_venue_within_the_match_radius(lat: float) -> None:
    rng = random.Random(lat)
    index = NearbyVenues(
        venue(f"osm:node/{i}", "x", lat + rng.uniform(-0.01, 0.01), rng.uniform(-0.02, 0.02))
        for i in range(600)
    )
    order = {v.id: i for i, v in enumerate(index.venues)}
    for query in index.venues[:60]:
        near = [order[v.id] for v in index.near(query.location)]
        assert near == sorted(near)  # insertion order
        within = {
            order[v.id]
            for v in index.venues
            if distance_m(query.location, v.location) <= MATCH_RADIUS_M
        }
        assert within <= set(near)


def test_merge_keeps_osm_and_drops_overture_duplicates() -> None:
    osm = [venue("osm:node/1", "La Marina", 38.88, -6.97)]
    overture = [
        venue("overture:a", "Bar La Marina", 38.8801, -6.97),
        venue("overture:b", "El Pilar", 38.881, -6.971),
        venue("overture:c", "Cervecería El Pilar", 38.8811, -6.971),
    ]
    merged = merge_venues(osm, overture)
    assert [v.id for v in merged] == ["osm:node/1", "overture:b"]


def test_a_mccafe_by_a_mcdonalds_is_its_counter() -> None:
    def place(i: str, name: str, lat: float) -> Venue:
        return Venue(
            id=i,
            name=name,
            kind="restaurant",
            location=LatLon(lat=lat, lon=-6.98),
            outdoor_seating=None,
        )

    host = place("overture:h", "McDonald's", 38.8700)
    counter = place("overture:c", "McCafé", 38.8703)  # 33 m away
    alone = place("overture:a", "McCafé", 38.8800)  # 1.1 km away
    assert drop_counters([host, counter, alone]) == [host, alone]


def test_read_places_filters_closed_low_confidence_foursquare_and_non_venues(
    tmp_path: Path,
) -> None:
    path = tmp_path / "places.parquet"
    duckdb.execute(
        f"""
        COPY (
          SELECT * FROM (VALUES
            ('ok', 'Bar Bueno', -6.97, 38.88, 0.9, 'open', 'bar', ['food_and_drink'], ['meta']),
            ('closed', 'Bar Cerrado', -6.97, 38.88, 0.9, 'permanently_closed', 'bar', [], ['meta']),
            ('low', 'Bar Dudoso', -6.97, 38.88, 0.3, 'open', 'bar', [], ['meta']),
            ('fsq', 'Bar Fsq', -6.97, 38.88, 0.9, 'open', 'bar', [], ['meta', 'Foursquare']),
            ('truck', 'Truck', -6.97, 38.88, 0.9, 'open', 'food_truck_stand', [], ['meta']),
            ('noname', NULL, -6.97, 38.88, 0.9, 'open', 'bar', [], ['meta'])
          ) AS t(id, name, lon, lat, confidence, operating_status, category, hierarchy, datasets)
        ) TO '{path}' (FORMAT parquet)
        """
    )
    venues = read_places(path)
    assert [(v.id, v.name, v.kind) for v in venues] == [("overture:ok", "Bar Bueno", "bar")]
    assert venues[0].outdoor_seating is None


def overture_release_file(path: Path) -> None:
    """A tiny file shaped like Overture's places release (only the columns we read)."""
    duckdb.execute(
        f"""
        COPY (
          SELECT 'a' AS id, {{'primary': 'Bar Sol'}} AS names,
                 {{'xmin': -6.97, 'xmax': -6.97, 'ymin': 38.88, 'ymax': 38.88}} AS bbox,
                 0.9 AS confidence, 'open' AS operating_status,
                 {{'primary': 'bar', 'hierarchy': ['food_and_drink', 'bar']}} AS taxonomy,
                 [{{'dataset': 'meta'}}] AS sources, ['https://barsol.es'] AS websites,
                 [{{'freeform': 'Calle Mayor, 1', 'locality': 'Badajoz', 'postcode': '06001',
                    'region': 'BA', 'country': 'ES'}}] AS addresses
        ) TO '{path}' (FORMAT parquet)
        """
    )


def test_fetch_places_writes_the_cache_only_when_complete(tmp_path: Path) -> None:
    release = tmp_path / "release.parquet"
    overture_release_file(release)
    cache = tmp_path / "cache"

    path = fetch_places(BADAJOZ_BBOX, cache, source=str(release))

    assert path == cache_path(cache)
    assert [v.id for v in read_places(path)] == ["overture:a"]
    assert sorted(p.name for p in cache.iterdir()) == [path.name]  # no `.part` left behind
    assert read_addresses(path) == {"overture:a": ["Calle Mayor, 1"]}


def test_read_addresses_without_the_column_or_the_file(tmp_path: Path) -> None:
    old = tmp_path / "old.parquet"
    duckdb.execute(f"COPY (SELECT 'a' AS id) TO '{old}' (FORMAT parquet)")
    assert read_addresses(old) == {}
    assert read_addresses(tmp_path / "missing.parquet") == {}
    empty = tmp_path / "empty.parquet"
    duckdb.execute(
        f"""COPY (SELECT 'a' AS id, [{{'freeform': NULL}}] AS addresses
                  UNION ALL SELECT 'b', []) TO '{empty}' (FORMAT parquet)"""
    )
    assert read_addresses(empty) == {}


def test_failed_fetch_places_leaves_no_cache(tmp_path: Path) -> None:
    with pytest.raises(duckdb.Error):
        fetch_places(BADAJOZ_BBOX, tmp_path, source=str(tmp_path / "missing.parquet"))
    assert not cache_path(tmp_path).exists()

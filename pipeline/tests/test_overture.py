from pathlib import Path

import duckdb
import pytest

from solycerveza.overture import (
    merge_venues,
    name_similarity,
    overture_kind,
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
        ("burger_restaurant", ["food_and_drink", "restaurant"], None),
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


def test_merge_keeps_osm_and_drops_overture_duplicates() -> None:
    osm = [venue("osm:node/1", "La Marina", 38.88, -6.97)]
    overture = [
        venue("overture:a", "Bar La Marina", 38.8801, -6.97),
        venue("overture:b", "El Pilar", 38.881, -6.971),
        venue("overture:c", "Cervecería El Pilar", 38.8811, -6.971),
    ]
    merged = merge_venues(osm, overture)
    assert [v.id for v in merged] == ["osm:node/1", "overture:b"]


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
            ('burger', 'Burger', -6.97, 38.88, 0.9, 'open', 'burger_restaurant', [], ['meta']),
            ('noname', NULL, -6.97, 38.88, 0.9, 'open', 'bar', [], ['meta'])
          ) AS t(id, name, lon, lat, confidence, operating_status, category, hierarchy, datasets)
        ) TO '{path}' (FORMAT parquet)
        """
    )
    venues = read_places(path)
    assert [(v.id, v.name, v.kind) for v in venues] == [("overture:ok", "Bar Bueno", "bar")]
    assert venues[0].outdoor_seating is None

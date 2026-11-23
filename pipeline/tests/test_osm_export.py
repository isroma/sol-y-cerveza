from datetime import date
from typing import Any
from xml.etree import ElementTree

from solycerveza.osm_export import (
    AddedVenue,
    OsmElement,
    build_query,
    parse_elements,
    plan,
    to_josm_xml,
)
from solycerveza.review import Review
from solycerveza.venues import LatLon

DAY = date(2026, 11, 23)
# About 20 m south-west of the venue: far enough for a seating node of its own.
VENUE = (38.866701, -6.98176)
TERRACE = (38.866566, -6.982021)


def review(venue_id: str, **fields: object) -> Review:
    return Review.model_validate({"venue_id": venue_id, "reviewed": DAY, **fields})


def node(
    node_id: int, lat: float, lon: float, tags: dict[str, str] | None = None
) -> dict[str, Any]:
    return {
        "type": "node",
        "id": node_id,
        "version": 3,
        "lat": lat,
        "lon": lon,
        "tags": tags or {},
    }


def osm(*elements: dict[str, Any]) -> dict[tuple[str, int], OsmElement]:
    return parse_elements({"elements": list(elements)})


def test_query_fetches_reviewed_elements_and_nearby_seating() -> None:
    query = build_query(
        [
            review("osm:node/1", status="terrace", terrace_lat=TERRACE[0], terrace_lon=TERRACE[1]),
            review("osm:way/2", status="no_terrace"),
        ],
        [],
    )
    assert "node(id:1);" in query
    assert "way(id:2);" in query
    assert "node(w:2);" in query
    assert f'node(around:10,{TERRACE[0]},{TERRACE[1]})["leisure"="outdoor_seating"];' in query
    assert query.endswith("out meta;\n")


def test_terrace_review_tags_moves_and_adds_a_seating_node() -> None:
    change = plan(
        [
            review(
                "osm:node/1",
                status="terrace",
                venue_lat=VENUE[0],
                venue_lon=VENUE[1],
                terrace_lat=TERRACE[0],
                terrace_lon=TERRACE[1],
            )
        ],
        [],
        osm(node(1, 38.8668, -6.9818, {"amenity": "cafe", "name": "McCafé"})),
    )
    moved = change.modified[("node", 1)]
    assert moved.tags == {"amenity": "cafe", "name": "McCafé", "outdoor_seating": "yes"}
    assert (moved.lat, moved.lon) == VENUE
    assert change.created == [{"lat": TERRACE[0], "lon": TERRACE[1], "leisure": "outdoor_seating"}]


def test_what_osm_already_has_is_left_out() -> None:
    change = plan(
        [
            review(
                "osm:node/1",
                status="terrace",
                venue_lat=VENUE[0],
                venue_lon=VENUE[1],
                terrace_lat=TERRACE[0],
                terrace_lon=TERRACE[1],
            )
        ],
        [],
        osm(
            node(1, VENUE[0], VENUE[1] + 0.00001, {"amenity": "cafe", "outdoor_seating": "yes"}),
            node(9, TERRACE[0], TERRACE[1] + 0.00005, {"leisure": "outdoor_seating"}),
        ),
    )
    assert change.empty
    assert change.notes == ["osm:node/1: OSM already has outdoor seating there"]


def test_terrace_next_to_the_venue_needs_no_seating_node() -> None:
    change = plan(
        [review("osm:node/1", status="terrace", terrace_lat=VENUE[0], terrace_lon=VENUE[1])],
        [],
        osm(node(1, VENUE[0], VENUE[1], {"amenity": "bar"})),
    )
    assert change.created == []
    assert change.modified[("node", 1)].tags["outdoor_seating"] == "yes"


def test_ways_get_tags_but_never_move() -> None:
    way = {"type": "way", "id": 2, "version": 5, "nodes": [10, 11], "tags": {"amenity": "bar"}}
    change = plan(
        [review("osm:way/2", status="no_terrace", venue_lat=VENUE[0], venue_lon=VENUE[1])],
        [],
        osm(way, node(10, 38.87, -6.97), node(11, 38.8701, -6.97)),
    )
    assert change.modified[("way", 2)].tags == {"amenity": "bar", "outdoor_seating": "no"}
    assert set(change.context) == {("node", 10), ("node", 11)}


def test_closed_venues_and_other_sources_are_not_changed() -> None:
    change = plan(
        [review("osm:node/1", status="not_venue"), review("overture:abc", status="terrace")],
        [],
        osm(node(1, VENUE[0], VENUE[1], {"amenity": "bar"})),
    )
    assert change.empty
    assert change.notes == [
        "osm:node/1: reviewed as not a venue; not changed in OSM (check on site)"
    ]


def test_added_venue_is_created_unless_osm_has_its_name_nearby() -> None:
    added = AddedVenue(
        id="overture:abc", name="McCafé", kind="cafe", location=LatLon(lat=VENUE[0], lon=VENUE[1])
    )
    reviews = [
        review("overture:abc", status="terrace", terrace_lat=TERRACE[0], terrace_lon=TERRACE[1])
    ]
    change = plan(reviews, [added], {})
    assert change.created == [
        {
            "lat": VENUE[0],
            "lon": VENUE[1],
            "amenity": "cafe",
            "name": "McCafé",
            "outdoor_seating": "yes",
        },
        {"lat": TERRACE[0], "lon": TERRACE[1], "leisure": "outdoor_seating"},
    ]

    known = plan(reviews, [added], osm(node(7, VENUE[0], VENUE[1], {"name": "mccafé"})))
    assert known.empty
    assert known.notes == ["overture:abc: OSM already has 'McCafé' as node/7"]


def test_josm_file_marks_changes_and_numbers_new_nodes() -> None:
    change = plan(
        [review("osm:node/1", status="terrace", terrace_lat=TERRACE[0], terrace_lon=TERRACE[1])],
        [],
        osm(node(1, VENUE[0], VENUE[1], {"amenity": "bar", "name": "Bar & Co"})),
    )
    root = ElementTree.fromstring(to_josm_xml(change))
    assert root.get("upload") == "true"
    modified, created = root.findall("node")
    assert modified.attrib == {
        "id": "1",
        "version": "3",
        "visible": "true",
        "action": "modify",
        "lat": "38.8667010",
        "lon": "-6.9817600",
    }
    assert [(t.get("k"), t.get("v")) for t in modified.findall("tag")] == [
        ("amenity", "bar"),
        ("name", "Bar & Co"),
        ("outdoor_seating", "yes"),
    ]
    assert created.get("id") == "-1"
    assert [(t.get("k"), t.get("v")) for t in created.findall("tag")] == [
        ("leisure", "outdoor_seating")
    ]

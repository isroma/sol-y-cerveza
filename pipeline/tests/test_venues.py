import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from solycerveza.geo import BoundingBox
from solycerveza.venues import (
    USER_AGENT,
    LatLon,
    OverpassError,
    Venue,
    build_query,
    fetch_overpass,
    load_venues,
    parse_venues,
)

# Recorded from overpass-api.de on 2026-11-22 and trimmed by hand. © OpenStreetMap contributors.
FIXTURE = Path(__file__).parent / "fixtures" / "overpass_venues.json"
URLS = ("https://one.example/api/interpreter", "https://two.example/api/interpreter")
BBOX = BoundingBox(south=38.84, west=-7.04, north=38.92, east=-6.92)


def fixture_data() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return data


class FakeOverpass:
    """Replays canned responses and records the requests it gets."""

    def __init__(self, *responses: httpx.Response | Exception) -> None:
        self.responses = list(responses)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self))


def ok(data: dict[str, Any] | None = None) -> httpx.Response:
    return httpx.Response(200, json=fixture_data() if data is None else data)


def test_query_asks_for_nodes_and_ways_of_every_kind_with_centres() -> None:
    query = build_query(BBOX)
    assert "node[" in query
    assert "way[" in query
    assert '"^(bar|pub|cafe|restaurant|biergarten)$"' in query
    assert "(38.84,-7.04,38.92,-6.92)" in query
    assert query.rstrip().endswith("out tags center;")


def test_parse_normalizes_nodes_and_ways_sorted_by_id() -> None:
    venues = parse_venues(fixture_data())

    assert [venue.id for venue in venues] == [
        "osm:node/10301087279",
        "osm:node/12949582124",
        "osm:node/6350940394",
        "osm:node/9384007214",
        "osm:way/551282200",
        "osm:way/564742757",
    ]
    assert venues[3] == Venue(
        id="osm:node/9384007214",
        name="Café Bar El Velador",
        kind="cafe",
        location=LatLon(lat=38.882512, lon=-6.995107),
        outdoor_seating="yes",
    )
    unnamed, way = venues[0], venues[4]
    assert unnamed.name is None
    assert unnamed.outdoor_seating == "no"
    assert way.location == LatLon(lat=38.88399, lon=-6.987658)
    assert way.outdoor_seating is None


def test_parse_skips_other_amenities_and_elements_without_position() -> None:
    data = {
        "elements": [
            {"type": "node", "id": 1, "lat": 38.9, "lon": -7.0, "tags": {"amenity": "bank"}},
            {"type": "way", "id": 2, "tags": {"amenity": "bar", "name": "Sin centro"}},
        ]
    }
    assert parse_venues(data) == []


def test_latlon_rounds_to_six_decimals() -> None:
    assert LatLon(lat=38.12345678, lon=-6.98765449) == LatLon(lat=38.123457, lon=-6.987654)


def test_fetch_sends_query_and_user_agent() -> None:
    fake = FakeOverpass(ok())
    with fake.client() as client:
        text = fetch_overpass("QUERY", client=client, urls=URLS, sleep=lambda _: None)

    assert json.loads(text) == fixture_data()
    (request,) = fake.requests
    assert request.method == "POST"
    assert request.headers["User-Agent"] == USER_AGENT
    assert request.content == b"data=QUERY"


def test_fetch_falls_back_to_the_next_instance_without_waiting() -> None:
    sleeps: list[float] = []
    fake = FakeOverpass(httpx.Response(504), ok())
    with fake.client() as client:
        fetch_overpass("Q", client=client, urls=URLS, sleep=sleeps.append)

    assert [str(request.url) for request in fake.requests] == list(URLS)
    assert sleeps == []


def test_fetch_backs_off_exponentially_between_rounds() -> None:
    sleeps: list[float] = []
    fake = FakeOverpass(
        httpx.Response(502),
        httpx.ConnectError("refused"),
        httpx.Response(429),
        ok({"elements": [], "remark": "runtime error: Query timed out in 'query'"}),
        httpx.Response(503),
        httpx.Response(200, text="<html>Gateway busy</html>"),
        ok(),
    )
    with fake.client() as client:
        fetch_overpass("Q", client=client, urls=URLS, backoff_s=1.5, sleep=sleeps.append)

    assert len(fake.requests) == 7
    assert sleeps == [1.5, 3.0, 6.0]


def test_fetch_gives_up_after_the_last_attempt() -> None:
    fake = FakeOverpass(*[httpx.Response(504) for _ in range(4)])
    with fake.client() as client, pytest.raises(OverpassError, match="after 2 attempts"):
        fetch_overpass("Q", client=client, urls=URLS, attempts=2, sleep=lambda _: None)


def test_fetch_does_not_retry_a_bad_query() -> None:
    fake = FakeOverpass(httpx.Response(400, text="parse error"))
    with fake.client() as client, pytest.raises(httpx.HTTPStatusError):
        fetch_overpass("Q", client=client, urls=URLS, sleep=lambda _: None)
    assert len(fake.requests) == 1


def test_load_caches_the_raw_response(tmp_path: Path) -> None:
    fake = FakeOverpass(ok())
    with fake.client() as client:
        first = load_venues(BBOX, tmp_path, client=client)
        second = load_venues(BBOX, tmp_path, client=client)

    assert len(fake.requests) == 1
    assert first == second == parse_venues(fixture_data())
    (cached,) = tmp_path.glob("overpass_venues_*.json")
    assert json.loads(cached.read_text(encoding="utf-8")) == fixture_data()


def test_load_refresh_downloads_again(tmp_path: Path) -> None:
    fake = FakeOverpass(ok({"elements": []}), ok())
    with fake.client() as client:
        assert load_venues(BBOX, tmp_path, client=client) == []
        refreshed = load_venues(BBOX, tmp_path, refresh=True, client=client)

    assert len(fake.requests) == 2
    assert len(refreshed) == 6

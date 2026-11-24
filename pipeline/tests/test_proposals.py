import json
from datetime import date
from pathlib import Path

import anthropic
import duckdb
import httpx
import httpx2
import pytest

from solycerveza.junta import RegisterRow, register_id
from solycerveza.ortho import Crop, OrthoFetcher, cached_crop
from solycerveza.overture import distance_m
from solycerveza.proposals import (
    AskAll,
    OvertureAttrs,
    Proposal,
    ask_vision,
    keep_dates,
    main,
    not_venue_score,
    overture_proposals,
    plan_vision,
    position_proposals,
    read_overture_attrs,
    read_proposals,
    read_records,
    vision_proposals,
    vision_to_ask,
    write_proposals,
)
from solycerveza.terrace_vision import (
    ANSWER_SCHEMA,
    MODEL,
    CachedAnswer,
    ClaudeAsker,
    NoAnswer,
    Unanswered,
    VisionAnswer,
    ask,
    estimate_usd,
)
from solycerveza.terraces import Terrace
from solycerveza.venues import LatLon

TODAY = date(2026, 11, 24)
CENTRE = LatLon(lat=38.878, lon=-6.97)


def record(
    venue_id: str, *, sources: list[str], at: LatLon = CENTRE, name: str = "Bar Sol"
) -> Terrace:
    return Terrace(
        id=venue_id,
        name=name,
        kind="bar",
        venue=at,
        terrace=None,
        sources=sources,
        verified=None,
    )


def answer_json(terrace: str, x: int | None = None, y: int | None = None) -> str:
    return json.dumps(
        {"terrace": terrace, "confidence": 0.8, "x": x, "y": y, "evidence": "Parasols south."}
    )


# --- Orthophoto crops ---------------------------------------------------------------------


def test_crop_maps_pixels_to_metres_around_the_venue() -> None:
    crop = Crop(CENTRE)
    assert crop.metres_per_px == pytest.approx(0.15)
    centre = crop.to_latlon(399.5, 399.5)
    assert distance_m(centre, CENTRE) < 0.05
    east = crop.to_latlon(399.5 + 100, 399.5)
    assert distance_m(east, CENTRE) == pytest.approx(15, abs=0.1)
    assert east.lon > CENTRE.lon
    north = crop.to_latlon(399.5, 399.5 - 100)
    assert north.lat > CENTRE.lat


def test_crop_url_is_a_wms_getmap_in_utm_29n() -> None:
    url = Crop(CENTRE).url
    assert url.startswith("https://www.ign.es/wms-inspire/pnoa-ma?")
    assert "REQUEST=GetMap" in url
    assert "CRS=EPSG%3A25829" in url
    assert "WIDTH=800" in url


def test_ortho_fetcher_caches_images_and_rejects_wms_errors(tmp_path: Path) -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert "sol-y-cerveza" in request.headers["user-agent"]
        if "BBOX=0" in str(request.url):
            return httpx.Response(200, headers={"content-type": "text/xml"}, content=b"<err/>")
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        fetcher = OrthoFetcher(client=client, cache_dir=tmp_path, sleep=lambda _: None)
        crop = Crop(CENTRE)
        assert fetcher.crop(crop) == b"jpeg"
        assert fetcher.crop(crop) == b"jpeg"
    assert len(calls) == 1
    assert cached_crop(crop, tmp_path) == b"jpeg"


# --- The Claude API answer ----------------------------------------------------------------


def test_ask_validates_the_answer() -> None:
    crop = Crop(CENTRE)
    good = ask(lambda _i, _p: answer_json("yes", 420, 380), "Bar", "bar", crop, b"x", TODAY)
    assert isinstance(good, CachedAnswer)
    assert good.answer.terrace == "yes" and good.asked == TODAY
    # Paid for but unusable: an `Unanswered` marker, which the caller caches.
    for unusable in ("not json", answer_json("yes"), answer_json("yes", 900, 10)):

        def asker(_image: bytes, _prompt: str, text: str = unusable) -> str:
            return text

        bad = ask(asker, "Bar", "bar", crop, b"x", TODAY)
        assert isinstance(bad, Unanswered) and bad.asked == TODAY
    refused = ask(lambda _i, _p: NoAnswer("stop_reason refusal"), "Bar", "bar", crop, b"x", TODAY)
    assert refused == Unanswered(reason="stop_reason refusal", asked=TODAY)
    # A transient failure: nothing to cache.
    assert ask(lambda _i, _p: None, "Bar", "bar", crop, b"x", TODAY) is None


def test_prompt_names_the_venue_and_the_limits() -> None:
    prompts: list[str] = []

    def asker(_image: bytes, prompt: str) -> str:
        prompts.append(prompt)
        return answer_json("unsure")

    ask(asker, "Bar Sol", "bar", Crop(CENTRE), b"x", TODAY)
    assert "Bar Sol (bar)" in prompts[0]
    assert "(400, 400)" in prompts[0]
    assert "weak evidence" in prompts[0]


def test_claude_asker_sends_image_schema_and_fallback() -> None:
    sent: list[dict[str, object]] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        sent.append(json.loads(request.content))
        return httpx2.Response(
            200,
            json={
                "id": "msg_1",
                "type": "message",
                "role": "assistant",
                "model": MODEL,
                "content": [{"type": "text", "text": answer_json("no")}],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 1},
            },
        )

    client = anthropic.Anthropic(
        api_key="test", http_client=httpx2.Client(transport=httpx2.MockTransport(handler))
    )
    text = ClaudeAsker(client)(b"jpeg", "prompt")
    assert isinstance(text, str) and VisionAnswer.model_validate_json(text).terrace == "no"
    body = sent[0]
    assert body["model"] == "claude-opus-5-5"
    assert body["fallbacks"] == "default"
    assert body["output_config"] == {
        "effort": "medium",
        "format": {"type": "json_schema", "schema": ANSWER_SCHEMA},
    }
    content = body["messages"][0]["content"]  # type: ignore[index]
    assert content[0]["source"]["media_type"] == "image/jpeg"


def message_client(status: int, body: dict[str, object]) -> anthropic.Anthropic:
    def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(status, json=body)

    return anthropic.Anthropic(
        api_key="test",
        max_retries=0,
        http_client=httpx2.Client(transport=httpx2.MockTransport(handler)),
    )


def test_claude_asker_gives_no_answer_for_a_refusal() -> None:
    client = message_client(
        200,
        {
            "id": "msg_1",
            "type": "message",
            "role": "assistant",
            "model": MODEL,
            "content": [],
            "stop_reason": "refusal",
            "stop_sequence": None,
            "usage": {"input_tokens": 1, "output_tokens": 1},
        },
    )
    assert ClaudeAsker(client)(b"jpeg", "prompt") == NoAnswer("stop_reason refusal")


def error_body(kind: str) -> dict[str, object]:
    return {"type": "error", "error": {"type": kind, "message": "nope"}}


@pytest.mark.parametrize(
    ("status", "kind", "error"),
    [
        (400, "invalid_request_error", anthropic.BadRequestError),
        (401, "authentication_error", anthropic.AuthenticationError),
        (403, "permission_error", anthropic.PermissionDeniedError),
        (404, "not_found_error", anthropic.NotFoundError),
    ],
)
def test_claude_asker_stops_the_run_on_errors_every_request_would_hit(
    status: int, kind: str, error: type[Exception]
) -> None:
    with pytest.raises(error):
        ClaudeAsker(message_client(status, error_body(kind)))(b"jpeg", "prompt")


def test_claude_asker_skips_a_venue_on_a_server_error() -> None:
    client = message_client(500, error_body("api_error"))
    assert ClaudeAsker(client)(b"jpeg", "prompt") is None


def test_estimate_scales_with_calls() -> None:
    low, high = estimate_usd(100)
    assert 0 < low < high
    assert estimate_usd(0) == (0, 0)


# --- Vision proposer ----------------------------------------------------------------------


def test_vision_proposals_from_answers() -> None:
    targets = [
        record("osm:node/1", sources=["osm"]),
        record("osm:node/2", sources=["osm"]),
        record("osm:node/3", sources=["osm"]),
    ]
    answers = {
        "osm:node/1": CachedAnswer(
            VisionAnswer.model_validate_json(answer_json("yes", 499, 399)), TODAY
        ),
        "osm:node/2": CachedAnswer(VisionAnswer.model_validate_json(answer_json("no")), TODAY),
        "osm:node/3": CachedAnswer(VisionAnswer.model_validate_json(answer_json("unsure")), TODAY),
    }
    proposals = vision_proposals(targets, answers)
    assert [(p.venue_id, p.kind) for p in proposals] == [
        ("osm:node/1", "terrace"),
        ("osm:node/2", "no_terrace"),
    ]
    terrace = proposals[0].location
    assert terrace is not None
    assert distance_m(terrace, CENTRE) == pytest.approx(15, abs=0.2)
    assert proposals[0].source == "pnoa-ortho+claude"
    assert proposals[1].location is None


def test_plan_and_ask_vision_use_the_caches(tmp_path: Path) -> None:
    ortho, vision = tmp_path / "ortho", tmp_path / "vision"
    targets = [record("osm:node/1", sources=["osm"])]
    plan = plan_vision(targets, ortho, vision)
    assert plan.cached == {} and [t.id for t in plan.to_ask] == ["osm:node/1"]

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg")

    asked: list[str] = []

    def asker(_image: bytes, prompt: str) -> str:
        asked.append(prompt)
        return answer_json("no")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        fetcher = OrthoFetcher(client=client, cache_dir=ortho, sleep=lambda _: None)
        answers = ask_vision(plan.to_ask, fetcher, asker, TODAY, vision)
    assert list(answers) == ["osm:node/1"] and len(asked) == 1
    again = plan_vision(targets, ortho, vision)
    assert list(again.cached) == ["osm:node/1"] and again.to_ask == []


def test_paid_requests_without_an_answer_are_cached_and_transient_failures_are_not(
    tmp_path: Path,
) -> None:
    ortho, vision = tmp_path / "ortho", tmp_path / "vision"
    refused = record("osm:node/1", sources=["osm"], name="Bar Uno")
    failed = record("osm:node/2", sources=["osm"], name="Bar Dos")

    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg")

    def asker(_image: bytes, prompt: str) -> NoAnswer | None:
        return NoAnswer("stop_reason refusal") if "Bar Uno" in prompt else None

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        fetcher = OrthoFetcher(client=client, cache_dir=ortho, sleep=lambda _: None)
        answers = ask_vision([refused, failed], fetcher, asker, TODAY, vision)
    assert answers == {}

    plan = plan_vision([refused, failed], ortho, vision)
    assert plan.cached == {}
    assert plan.unanswered == {"osm:node/1": Unanswered(reason="stop_reason refusal", asked=TODAY)}
    assert [t.id for t in plan.to_ask] == ["osm:node/2"]  # only this one costs again


def test_vision_call_budget() -> None:
    targets = [record(f"osm:node/{i}", sources=["osm"]) for i in range(3)]
    assert vision_to_ask(targets, None) == []
    assert vision_to_ask(targets, 0) == []
    assert [t.id for t in vision_to_ask(targets, 2)] == ["osm:node/0", "osm:node/1"]
    assert vision_to_ask(targets, AskAll()) == targets
    with pytest.raises(ValueError, match="negative"):
        vision_to_ask(targets, -1)


@pytest.mark.parametrize("limit", ["-1", "-5", "two"])
def test_limit_must_be_a_non_negative_number(limit: str) -> None:
    with pytest.raises(SystemExit) as exit_info:
        main(["--limit", limit])
    assert exit_info.value.code == 2


# --- Overture proposer --------------------------------------------------------------------


def test_not_venue_score_adds_up_the_warning_signs() -> None:
    solid = OvertureAttrs(
        confidence=0.95, category="bar", datasets=("meta", "microsoft"), has_website=True
    )
    weak = OvertureAttrs(confidence=0.62, category="lounge", datasets=("meta",), has_website=False)
    solid_score, _ = not_venue_score("Bar Sol", solid)
    weak_score, reasons = not_venue_score("Bar", weak)
    assert solid_score == pytest.approx(0.15)
    assert weak_score == pytest.approx(0.9)
    assert "no website" in reasons and "a generic name" in reasons


def test_overture_proposals_only_for_overture_only_records() -> None:
    attrs = {
        "overture:a": OvertureAttrs(0.65, "bar", ("meta",), False),
        "overture:b": OvertureAttrs(0.65, "bar", ("meta",), False),
    }
    records = [
        record("overture:a", sources=["overture"]),
        record("overture:b", sources=["curated", "overture"]),
        record("overture:c", sources=["overture"]),
    ]
    proposals = overture_proposals(records, attrs, TODAY)
    assert [(p.venue_id, p.kind, p.confidence) for p in proposals] == [
        ("overture:a", "not_venue", 0.75)
    ]
    assert proposals[0].evidence == "Overture confidence 0.65; one source (meta); no website."


def test_read_overture_attrs(tmp_path: Path) -> None:
    path = tmp_path / "places.parquet"
    duckdb.execute(
        f"""
        COPY (
          SELECT * FROM (VALUES
            ('a', 0.7, 'bar', ['meta', 'microsoft'], ['https://bar.es']),
            ('b', 0.6, 'cafe', ['meta'], [])
          ) AS t(id, confidence, category, datasets, websites)
        ) TO '{path}' (FORMAT parquet)
        """
    )
    attrs = read_overture_attrs(path)
    assert attrs["overture:a"] == OvertureAttrs(0.7, "bar", ("meta", "microsoft"), True)
    assert attrs["overture:b"].has_website is False


# --- Position proposer --------------------------------------------------------------------


def row(name: str) -> RegisterRow:
    return RegisterRow(name=name, kind="bar", street="CALLE MAYOR", number="1", opened=None)


def offset(point: LatLon, north_m: float) -> LatLon:
    return LatLon(lat=point.lat + north_m / 111_195, lon=point.lon)


def test_position_proposals_for_matched_venues_far_from_their_portal() -> None:
    portal = CENTRE
    junta = row("Bar Sol")
    records = [
        record(register_id(junta), sources=["junta"], at=portal),  # sits at its own portal
        record("overture:far", sources=["overture"], at=offset(portal, 40), name="Bar Luna"),
        record("overture:near", sources=["overture"], at=offset(portal, 10), name="Taberna Rio"),
    ]
    located = [(junta, portal), (row("Bar Luna"), portal), (row("Taberna Rio"), portal)]
    proposals = position_proposals(records, located, TODAY)
    assert [(p.venue_id, p.kind) for p in proposals] == [("overture:far", "position")]
    p = proposals[0]
    assert p.location == portal
    assert p.confidence == 0.95
    assert "CALLE MAYOR 1" in p.evidence and "40 m" in p.evidence


# --- The CSV ------------------------------------------------------------------------------


def test_proposal_needs_a_position_only_for_terrace_and_position() -> None:
    base = {"venue_id": "osm:node/1", "confidence": 0.5, "evidence": "x", "source": "s"}
    with pytest.raises(ValueError, match="lat/lon"):
        Proposal.model_validate({**base, "kind": "terrace", "generated": TODAY})
    with pytest.raises(ValueError, match="lat/lon"):
        Proposal.model_validate(
            {**base, "kind": "not_venue", "lat": 38.0, "lon": -6.0, "generated": TODAY}
        )
    with pytest.raises(ValueError, match="confidence"):
        Proposal.model_validate(
            {**base, "kind": "not_venue", "confidence": 1.2, "generated": TODAY}
        )


def test_write_and_read_round_trip_sorted(tmp_path: Path) -> None:
    path = tmp_path / "venue_proposals.csv"
    rows = [
        Proposal(
            venue_id="overture:b",
            kind="not_venue",
            confidence=0.756,
            evidence="Overture confidence 0.62, no website.",
            source="overture-attributes",
            generated=TODAY,
        ),
        Proposal(
            venue_id="junta:0123456789ab",
            kind="position",
            lat=38.1234567,
            lon=-6.9,
            confidence=0.9,
            evidence="Portal 30 m away.",
            source="junta+cartociudad",
            generated=TODAY,
        ),
    ]
    write_proposals(rows, path)
    assert path.read_text(encoding="utf-8") == (
        "venue_id,kind,lat,lon,confidence,evidence,source,generated\n"
        "junta:0123456789ab,position,38.123457,-6.900000,0.90,Portal 30 m away.,"
        "junta+cartociudad,2026-11-24\n"
        'overture:b,not_venue,,,0.76,"Overture confidence 0.62, no website.",'
        "overture-attributes,2026-11-24\n"
    )
    assert read_proposals(path) == sorted(
        [r.model_copy(update={"confidence": round(r.confidence, 2)}) for r in rows],
        key=lambda r: r.venue_id,
    )


def test_keep_dates_of_unchanged_rows() -> None:
    old = Proposal(
        venue_id="overture:a",
        kind="not_venue",
        confidence=0.6,
        evidence="e",
        source="s",
        generated=date(2026, 1, 1),
    )
    same = old.model_copy(update={"generated": TODAY})
    changed = old.model_copy(update={"generated": TODAY, "confidence": 0.7})
    assert [p.generated for p in keep_dates([old], [same, changed])] == [date(2026, 1, 1), TODAY]


def test_read_records_reads_a_terraces_file(tmp_path: Path) -> None:
    path = tmp_path / "terraces.json"
    data = {
        "version": 2,
        "terraces": [record("osm:node/2", sources=["osm"]).model_dump(mode="json")],
    }
    path.write_text(json.dumps(data), encoding="utf-8")
    assert [t.id for t in read_records(path)] == ["osm:node/2"]

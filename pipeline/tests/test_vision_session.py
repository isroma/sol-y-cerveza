import json
from datetime import date
from pathlib import Path

import httpx
import pytest

from solycerveza.ortho import OrthoFetcher
from solycerveza.proposals import Targets, plan_vision, run_proposers
from solycerveza.terrace_vision import MODEL, SESSION_MODEL, SYSTEM
from solycerveza.terraces import Terrace
from solycerveza.venues import LatLon
from solycerveza.vision_session import (
    AnswerFileError,
    TaskFile,
    export_tasks,
    import_answers,
    main,
    read_tasks,
)

TODAY = date(2026, 11, 25)


def record(venue_id: str, name: str) -> Terrace:
    return Terrace(
        id=venue_id,
        name=name,
        kind="bar",
        venue=LatLon(lat=38.878, lon=-6.97),
        terrace=None,
        sources=["osm"],
        verified=None,
    )


TARGETS = [record("osm:node/1", "Bar Uno"), record("osm:node/2", "Bar Dos")]


def fetcher(client: httpx.Client, cache: Path) -> OrthoFetcher:
    return OrthoFetcher(client=client, cache_dir=cache, sleep=lambda _: None)


def export(tmp_path: Path, targets: list[Terrace] = TARGETS) -> TaskFile:
    def handler(_request: httpx.Request) -> httpx.Response:
        # One image for both venues is enough: the key also hashes the name.
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=b"jpeg")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        return export_tasks(
            targets, fetcher(client, tmp_path / "ortho"), tmp_path / "out", tmp_path / "vision"
        )


def answer(key: str, terrace: str = "no", **extra: object) -> dict[str, object]:
    return {
        "key": key,
        "terrace": terrace,
        "confidence": 0.7,
        "x": None,
        "y": None,
        "evidence": "A narrow street with cars along the facade.",
    } | extra


def test_export_writes_only_what_the_judge_may_see(tmp_path: Path) -> None:
    tasks = export(tmp_path)
    assert tasks.system == SYSTEM
    assert [t.name for t in tasks.tasks] == ["Bar Uno", "Bar Dos"]
    text = (tmp_path / "out" / "tasks.json").read_text(encoding="utf-8")
    assert "osm:node" not in text  # no venue ids, let alone decisions
    assert read_tasks(tmp_path / "out" / "tasks.json") == tasks
    task = tasks.tasks[0]
    assert (tmp_path / "out" / task.image).read_bytes() == b"jpeg"
    assert "Venue: Bar Uno (bar)." in task.prompt and task.size_px == 800


def test_imported_answers_are_read_as_session_answers_only(tmp_path: Path) -> None:
    tasks = export(tmp_path)
    uno, dos = (t.key for t in tasks.tasks)
    text = json.dumps([answer(uno, "yes", x=500, y=400), answer(dos, "unsure")])
    assert import_answers(tasks, text, TODAY, tmp_path / "vision") == 2

    ortho, vision = tmp_path / "ortho", tmp_path / "vision"
    session = plan_vision(TARGETS, ortho, vision, model=SESSION_MODEL)
    assert sorted(session.cached) == ["osm:node/1", "osm:node/2"] and session.to_ask == []
    assert session.cached["osm:node/1"].asked == TODAY
    api = plan_vision(TARGETS, ortho, vision, model=MODEL)
    assert api.cached == {} and len(api.to_ask) == 2  # never mixed with API answers

    # A second export leaves out what is answered.
    assert export(tmp_path).tasks == []


def test_run_proposers_reads_session_answers_without_calling_the_api(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import solycerveza.proposals as proposals

    tasks = export(tmp_path)
    uno, dos = (t.key for t in tasks.tasks)
    import_answers(
        tasks,
        json.dumps([answer(uno, "yes", x=500, y=400), answer(dos)]),
        TODAY,
        tmp_path / "vision",
    )
    real = proposals.plan_vision

    def plan_in_tmp(targets: list[Terrace], model: str = MODEL) -> proposals.VisionPlan:
        return real(targets, tmp_path / "ortho", tmp_path / "vision", model=model)

    monkeypatch.setattr(proposals, "plan_vision", plan_in_tmp)

    def no_api(_image: bytes, _prompt: str) -> str:
        raise AssertionError("the session path must not call the API")

    found, ran = run_proposers(
        Targets(vision=TARGETS, position=[], overture=[]),
        {"vision"},
        ask_limit=None,
        today=TODAY,
        asker=no_api,
        vision_model=SESSION_MODEL,
    )
    assert [(p.venue_id, p.kind, p.source) for p in found] == [
        ("osm:node/1", "terrace", "pnoa-ortho+claude-session"),
        ("osm:node/2", "no_terrace", "pnoa-ortho+claude-session"),
    ]
    assert ran["vision"] == ["osm:node/1", "osm:node/2"]


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        (lambda k: [answer("0" * 24)], "not a task"),
        (lambda k: [answer(k), answer(k)], "answered twice"),
        (lambda k: [answer(k, "yes")], "without a pixel"),
        (lambda k: [answer(k, "yes", x=800, y=10)], "without a pixel"),
        (lambda k: [answer(k, confidence=1.5)], "confidence"),
        (lambda k: [answer(k, extra="no")], "extra"),
    ],
)
def test_an_invalid_file_imports_nothing(tmp_path: Path, bad: object, message: str) -> None:
    tasks = export(tmp_path)
    key = tasks.tasks[0].key
    good = answer(tasks.tasks[1].key)
    assert callable(bad)
    text = json.dumps([good, *bad(key)])
    with pytest.raises(AnswerFileError, match=message):
        import_answers(tasks, text, TODAY, tmp_path / "vision")
    assert not (tmp_path / "vision").exists()


def test_import_command_reports_problems(tmp_path: Path) -> None:
    tasks = export(tmp_path)
    answers = tmp_path / "answers.json"
    answers.write_text(json.dumps([answer("f" * 24)]), encoding="utf-8")
    assert main(["import", str(answers), "--tasks", str(tmp_path / "out" / "tasks.json")]) == 1
    assert tasks.tasks

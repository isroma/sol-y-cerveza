"""Terrace answers from a Claude Code session instead of the Claude API (ADR-0008).

The vision proposer (`solycerveza.terrace_vision`) normally asks the Claude API about each
orthophoto crop, which needs an API key. Here a Claude Code session looks at the same crops
itself, in two steps:

1. `python -m solycerveza.vision_session export [--evaluate] [--limit N]` fetches the PNOA
   crops (the fetch stage; cached in `.cache/ortho/`) for the venues still without a session
   answer and writes a task file, `.cache/vision-session/tasks.json`, with a copy of each crop in
   `.cache/vision-session/crops/`. A task holds only what the judge may see: an opaque key, the
   venue's name and kind, the image and the same prompt the API gets (`SYSTEM` and
   `prompt_text`). No venue id and no review decision, so a trial on reviewed venues stays blind.
   `--evaluate` exports the venues with a terrace decision, as they were before the review (the
   trial); without it, the unreviewed venues without a terrace.
2. The session answers each task in the `VisionAnswer` shape and saves a JSON list of
   `{"key", "terrace", "confidence", "x", "y", "evidence"}`; then
   `python -m solycerveza.vision_session import ANSWERS` validates the whole file (known keys,
   no duplicates, `VisionAnswer`, a pixel inside the image for "yes") and, only if every answer
   is valid, caches them in `.cache/vision/` under the model label `SESSION_MODEL`.

`python -m solycerveza.proposals --vision session [--evaluate]` then reads them like cached API
answers, with the source `pnoa-ortho+claude-session`, so they are never mixed with API answers.
"""

import argparse
import logging
import shutil
from collections.abc import Sequence
from datetime import date
from pathlib import Path
from typing import Annotated

import httpx
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from solycerveza.ortho import ORTHO_CACHE, Crop, OrthoFetcher
from solycerveza.proposals import TERRACES_JSON, plan_vision, pre_review_records, read_records
from solycerveza.review import read_review
from solycerveza.terrace_vision import (
    SESSION_MODEL,
    SYSTEM,
    VISION_CACHE,
    CachedAnswer,
    VisionAnswer,
    answer_key,
    pixel_problem,
    prompt_text,
    write_answer,
)
from solycerveza.terraces import Terrace
from solycerveza.venues import CACHE_DIR

logger = logging.getLogger(__name__)

SESSION_DIR = CACHE_DIR / "vision-session"
TASKS_FILE = "tasks.json"

ANSWER_FORMAT = (
    "Reply for each task with a JSON object "
    '{"key": "<the task key>", "terrace": "yes" | "no" | "unsure", "confidence": 0-1, '
    '"x": <int or null>, "y": <int or null>, "evidence": "<one short English sentence>"}; '
    "x and y are the pixel of the tables for yes, null otherwise."
)


class Task(BaseModel):
    """One crop to judge: only what the judge may see."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    key: Annotated[str, Field(pattern=r"^[0-9a-f]{24}$")]
    name: str
    kind: str
    image: str  # path relative to the task file
    size_px: Annotated[int, Field(gt=0)]
    prompt: str


class TaskFile(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    system: str
    answer_format: str
    tasks: list[Task]


class SessionAnswer(VisionAnswer):
    """A `VisionAnswer` with the key of the task it answers."""

    key: str


_ANSWERS = TypeAdapter(list[SessionAnswer])


def export_tasks(
    targets: Sequence[Terrace],
    fetcher: OrthoFetcher,
    out_dir: Path = SESSION_DIR,
    vision_cache: Path = VISION_CACHE,
    limit: int | None = None,
) -> TaskFile:
    """Fetch the crops of the targets without a session answer and write the task file."""
    plan = plan_vision(
        targets, ortho_cache=fetcher.cache_dir, vision_cache=vision_cache, model=SESSION_MODEL
    )
    pending = plan.to_ask if limit is None else plan.to_ask[:limit]
    crops_dir = out_dir / "crops"
    crops_dir.mkdir(parents=True, exist_ok=True)
    tasks: list[Task] = []
    for t in pending:
        crop = Crop(t.venue)
        image = fetcher.crop(crop)
        if image is None:
            continue
        key = answer_key(t.name, t.kind, image, SESSION_MODEL)
        (crops_dir / f"{key}.jpg").write_bytes(image)
        tasks.append(
            Task(
                key=key,
                name=t.name,
                kind=t.kind,
                image=f"crops/{key}.jpg",
                size_px=crop.size_px,
                prompt=prompt_text(t.name, t.kind, crop),
            )
        )
    task_file = TaskFile(system=SYSTEM, answer_format=ANSWER_FORMAT, tasks=tasks)
    (out_dir / TASKS_FILE).write_text(task_file.model_dump_json(indent=1) + "\n", encoding="utf-8")
    logger.info(
        "%d tasks -> %s (%d targets already answered, %d crops not fetched)",
        len(tasks),
        out_dir / TASKS_FILE,
        len(plan.cached) + len(plan.unanswered),
        len(pending) - len(tasks),
    )
    return task_file


def read_tasks(path: Path) -> TaskFile:
    return TaskFile.model_validate_json(path.read_text(encoding="utf-8"))


class AnswerFileError(ValueError):
    """The answers file has problems; nothing was imported."""


def check_answers(tasks: TaskFile, text: str) -> list[SessionAnswer]:
    """Every answer, validated against its task; `AnswerFileError` lists all problems."""
    try:
        answers = _ANSWERS.validate_json(text)
    except ValidationError as error:
        raise AnswerFileError(str(error)) from None
    by_key = {t.key: t for t in tasks.tasks}
    problems: list[str] = []
    seen: set[str] = set()
    for a in answers:
        task = by_key.get(a.key)
        if task is None:
            problems.append(f"{a.key}: not a task in the task file")
            continue
        if a.key in seen:
            problems.append(f"{a.key}: answered twice")
        seen.add(a.key)
        problem = pixel_problem(a, task.size_px)
        if problem is not None:
            problems.append(f"{a.key}: {problem}")
    if problems:
        raise AnswerFileError("; ".join(problems))
    return answers


def import_answers(
    tasks: TaskFile, text: str, today: date, vision_cache: Path = VISION_CACHE
) -> int:
    """Cache every answer under `SESSION_MODEL`, or none if any is invalid; returns the count."""
    answers = check_answers(tasks, text)
    for a in answers:
        answer = VisionAnswer.model_validate(a.model_dump(exclude={"key"}))
        write_answer(a.key, CachedAnswer(answer=answer, asked=today), vision_cache)
    return len(answers)


def export_targets(evaluate: bool, baseline: Path | None) -> list[Terrace]:
    """The venues to export: the trial's (`evaluate`) or the unreviewed ones without a terrace."""
    reviews = read_review()
    if evaluate:
        # Imported here: proposals_eval imports solycerveza.proposals, as this module does.
        from solycerveza.proposals_eval import evaluation_targets

        records = read_records(baseline) if baseline else pre_review_records()
        return evaluation_targets(records, reviews).vision
    reviewed = {r.venue_id for r in reviews}
    return [t for t in read_records(TERRACES_JSON) if t.id not in reviewed and t.terrace is None]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Terrace answers from a Claude Code session, no API key (ADR-0008)."
    )
    commands = parser.add_subparsers(dest="command", required=True)
    export = commands.add_parser("export", help="fetch the crops and write the task file")
    export.add_argument(
        "--evaluate",
        action="store_true",
        help="the trial: venues with a terrace decision, as before the review",
    )
    export.add_argument(
        "--baseline",
        type=Path,
        help="with --evaluate: a terraces.json from before the review",
    )
    export.add_argument("--limit", type=int, help="export at most N tasks")
    export.add_argument("--out", type=Path, default=SESSION_DIR, help="default %(default)s")
    imp = commands.add_parser("import", help="validate and cache a session's answers")
    imp.add_argument("answers", type=Path, help="JSON list of answers")
    imp.add_argument(
        "--tasks", type=Path, default=SESSION_DIR / TASKS_FILE, help="default %(default)s"
    )
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    if args.command == "export":
        if args.limit is not None and args.limit < 0:
            parser.error("--limit must be 0 or more")
        targets = export_targets(args.evaluate, args.baseline)
        # A fresh task file each time; the answers themselves live in .cache/vision/.
        shutil.rmtree(args.out / "crops", ignore_errors=True)
        with httpx.Client() as client:
            export_tasks(
                targets,
                OrthoFetcher(client=client, cache_dir=ORTHO_CACHE),
                args.out,
                limit=args.limit,
            )
        return 0

    try:
        count = import_answers(
            read_tasks(args.tasks), args.answers.read_text(encoding="utf-8"), date.today()
        )
    except AnswerFileError as error:
        logger.error("nothing imported: %s", error)
        return 1
    logger.info("%d session answers cached in %s", count, VISION_CACHE)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

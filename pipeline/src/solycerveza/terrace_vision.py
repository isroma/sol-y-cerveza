"""Ask the Claude API whether an orthophoto crop shows a venue's terrace (ADR-0008).

One request per venue: the crop from `solycerveza.ortho` (the venue at the centre) plus the
venue's name and kind. The answer is JSON (structured output) validated by `VisionAnswer`:
`yes` / `no` / `unsure`, a confidence, the pixel of the tables when `yes`, and one sentence of
evidence. The prompt states what an aerial photo cannot show, so "no" is used sparingly.

Answers are cached in `.cache/vision/`, keyed by model, prompt version and image, so a re-run
or an evaluation costs nothing. A request the model answered without a usable answer (a refusal,
`max_tokens`, an answer that does not validate, "yes" without a pixel) was paid for too, so it is
cached as `Unanswered` with its reason and not asked again. Transient failures (5xx, 429, a lost
connection) are not cached; errors that would fail every request (authentication, permission,
billing, a bad request, an unknown model) stop the run. Only `ClaudeAsker` touches the network;
the key comes from `ANTHROPIC_API_KEY` (or any credential the Anthropic SDK finds).

Answers can also come from a Claude Code session that looks at the crops itself, with no API key
(`solycerveza.vision_session`). They are cached the same way under the model label
`SESSION_MODEL`, so the two kinds of answer never share a cache key and are told apart by
`MODELS` (model label -> proposal source).
"""

import base64
import hashlib
import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Literal

import anthropic
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from solycerveza.ortho import Crop
from solycerveza.venues import CACHE_DIR

logger = logging.getLogger(__name__)

MODEL = "claude-opus-5-5"
# The label of answers recorded by a Claude Code session (`solycerveza.vision_session`).
SESSION_MODEL = "claude-code-session"
# Model label -> the `source` of its proposals in `venue_proposals.csv`.
MODELS = {MODEL: "pnoa-ortho+claude", SESSION_MODEL: "pnoa-ortho+claude-session"}
# Bump when the prompt or the schema changes, so cached answers are not reused.
PROMPT_VERSION = "1"
VISION_CACHE = CACHE_DIR / "vision"
MAX_TOKENS = 16_000
# Rough cost per venue, for the estimate printed before running: an 800 px image is about
# 850 input tokens, the prompt about 700, and thinking plus the answer about 1,000-2,500
# output tokens. Opus 5.5 lists at $4 / $20 per million input / output tokens.
EST_INPUT_TOKENS = 1_600
EST_OUTPUT_TOKENS = (1_000, 2_500)
PRICE_PER_MTOK = (4.0, 20.0)


class VisionAnswer(BaseModel):
    """What the model says about one crop."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    terrace: Literal["yes", "no", "unsure"]
    confidence: Annotated[float, Field(ge=0, le=1)]
    x: Annotated[int, Field(ge=0)] | None = None
    y: Annotated[int, Field(ge=0)] | None = None
    evidence: Annotated[str, Field(min_length=1, max_length=300)]


# The structured-output schema sent to the API (range checks are left to `VisionAnswer`).
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "terrace": {"type": "string", "enum": ["yes", "no", "unsure"]},
        "confidence": {"type": "number"},
        "x": {"type": ["integer", "null"]},
        "y": {"type": ["integer", "null"]},
        "evidence": {"type": "string"},
    },
    "required": ["terrace", "confidence", "x", "y", "evidence"],
    "additionalProperties": False,
}

SYSTEM = """\
You help the owner of a map of bar and restaurant terraces in Badajoz, Spain. You look at one \
aerial orthophoto crop per venue and say whether the venue has an outdoor terrace (tables and \
chairs outside, often with parasols or a "velador" area on the pavement, a plaza or a patio). \
The owner confirms or rejects every answer, and your accuracy is measured against their \
decisions, so an honest "unsure" is better than a guess."""

PROMPT = """\
Venue: {name} ({kind}).

The image is a {size} x {size} px crop of the PNOA orthophoto (Spain's national aerial photo, \
the most recent flight; its date is unknown to you and it may be a year or more old). North is \
up. It covers {width:.0f} m x {width:.0f} m, so one pixel is about {mpp:.2f} m. The venue's \
listed position is the centre pixel ({centre}, {centre}), but listed positions are often 10-30 m \
off, and the venue may be any ground-floor premises near the centre.

Limits of an aerial photo, which you must weigh:
- A table is only a few pixels across. Parasols, rows of chairs and table clusters on a \
pavement or plaza are the usual signs.
- Furniture may be stacked away at the time of the flight; awnings, arcades, trees and \
building shadows hide terraces; cars, market stalls, benches, bins and rooftop or private \
garden furniture can look like tables.
- So seeing nothing is weak evidence. Answer "no" only when there is clearly no room for \
tables in front of the venue (for example a narrow street with cars parked along the facade) \
or the area is plainly visible and empty; otherwise answer "unsure".
- Answer "yes" only for outdoor seating that plausibly belongs to this venue, not to a \
neighbour across the plaza.

Answer with:
- terrace: "yes", "no" or "unsure".
- confidence: 0 to 1, how likely your answer is right.
- x, y: for "yes", the pixel at the centre of the venue's tables; null otherwise.
- evidence: one short English sentence on what you see (or cannot see) and where."""


def prompt_text(name: str, kind: str, crop: Crop) -> str:
    return PROMPT.format(
        name=name,
        kind=kind,
        size=crop.size_px,
        width=2 * crop.radius_m,
        mpp=crop.metres_per_px,
        centre=crop.size_px // 2,
    )


def estimate_usd(calls: int) -> tuple[float, float]:
    """(low, high) dollar estimate for `calls` uncached requests."""
    price_in, price_out = PRICE_PER_MTOK
    low, high = (
        calls * (EST_INPUT_TOKENS * price_in + out * price_out) / 1_000_000
        for out in EST_OUTPUT_TOKENS
    )
    return (low, high)


def answer_key(name: str, kind: str, image: bytes, model: str = MODEL) -> str:
    text = f"{model}|{PROMPT_VERSION}|{name}|{kind}|{hashlib.sha256(image).hexdigest()}"
    return hashlib.sha256(text.encode()).hexdigest()[:24]


@dataclass(frozen=True)
class CachedAnswer:
    answer: VisionAnswer
    asked: date


@dataclass(frozen=True)
class Unanswered:
    """A paid request that gave no usable answer; cached so a re-run does not pay again."""

    reason: str
    asked: date


@dataclass(frozen=True)
class NoAnswer:
    """What an `Asker` returns when the model answered but with nothing usable."""

    reason: str


def read_answer(key: str, cache_dir: Path = VISION_CACHE) -> CachedAnswer | Unanswered | None:
    path = cache_dir / f"{key}.json"
    if not path.exists():
        return None
    raw = json.loads(path.read_text(encoding="utf-8"))
    asked = date.fromisoformat(raw["asked"])
    if "unanswered" in raw:
        return Unanswered(reason=str(raw["unanswered"]), asked=asked)
    return CachedAnswer(answer=VisionAnswer.model_validate(raw["answer"]), asked=asked)


def write_answer(
    key: str, cached: CachedAnswer | Unanswered, cache_dir: Path = VISION_CACHE
) -> None:
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{key}.json"
    record: dict[str, str | dict[str, Any]]
    if isinstance(cached, Unanswered):
        record = {"unanswered": cached.reason, "asked": cached.asked.isoformat()}
    else:
        record = {
            "answer": cached.answer.model_dump(mode="json"),
            "asked": cached.asked.isoformat(),
        }
    partial = path.with_suffix(".part")
    partial.write_text(json.dumps(record, ensure_ascii=False, indent=1), encoding="utf-8")
    partial.replace(path)


# (image JPEG, prompt) -> the model's raw JSON text, `NoAnswer` when the model answered with
# nothing usable (cached), or None after a transient failure of this one request (not cached).
Asker = Callable[[bytes, str], str | NoAnswer | None]

# Errors that would fail every request alike (credentials, permissions, billing, a malformed
# request or an unknown model): the run stops instead of logging one per venue.
FATAL_API_ERRORS: tuple[type[anthropic.APIStatusError], ...] = (
    anthropic.AuthenticationError,
    anthropic.PermissionDeniedError,
    anthropic.PaymentRequiredError,
    anthropic.BadRequestError,
    anthropic.NotFoundError,
)


class ClaudeAsker:
    """The real `Asker`: one Messages API request with the image and a JSON schema."""

    def __init__(self, client: anthropic.Anthropic | None = None) -> None:
        self.client = client or anthropic.Anthropic()

    def __call__(self, image: bytes, prompt: str) -> str | NoAnswer | None:
        data = base64.standard_b64encode(image).decode("ascii")
        try:
            response = self.client.beta.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=SYSTEM,
                thinking={"type": "adaptive"},
                output_config={
                    "effort": "medium",
                    "format": {"type": "json_schema", "schema": ANSWER_SCHEMA},
                },
                # On a safety decline the API re-runs the request on a fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": "image/jpeg",
                                    "data": data,
                                },
                            },
                            {"type": "text", "text": prompt},
                        ],
                    }
                ],
            )
        except anthropic.RateLimitError, anthropic.APIConnectionError:
            raise  # the SDK already retried; stop the run rather than skip venues
        except FATAL_API_ERRORS:
            raise  # every other request would fail the same way
        except anthropic.APIStatusError as error:
            # This request only (a 5xx after the SDK's retries, a timeout, a too-large image):
            # skip the venue and ask again next run.
            logger.warning("Claude API: HTTP %d %s", error.status_code, error.message)
            return None
        if response.stop_reason in ("refusal", "max_tokens"):
            logger.warning("Claude API: stopped with %s", response.stop_reason)
            return NoAnswer(f"stop_reason {response.stop_reason}")
        return "".join(block.text for block in response.content if block.type == "text")


def ask(
    asker: Asker, name: str, kind: str, crop: Crop, image: bytes, today: date
) -> CachedAnswer | Unanswered | None:
    """Ask once and validate.

    `Unanswered` when the model answered with nothing usable (worth caching: it was paid for),
    None when the request failed transiently (ask again next run).
    """
    text = asker(image, prompt_text(name, kind, crop))
    if text is None:
        return None
    if isinstance(text, NoAnswer):
        return Unanswered(reason=text.reason, asked=today)
    try:
        answer = VisionAnswer.model_validate_json(text)
    except ValidationError as error:
        logger.warning("%s: answer does not validate: %s", name, error)
        return Unanswered(reason=f"invalid answer: {error.error_count()} errors", asked=today)
    problem = pixel_problem(answer, crop.size_px)
    if problem is not None:
        logger.warning("%s: %s", name, problem)
        return Unanswered(reason=problem, asked=today)
    return CachedAnswer(answer=answer, asked=today)


def pixel_problem(answer: VisionAnswer, size_px: int) -> str | None:
    """Why a valid answer is still unusable ("yes" needs a pixel inside the image), or None."""
    if answer.terrace == "yes" and (
        answer.x is None or answer.y is None or answer.x >= size_px or answer.y >= size_px
    ):
        return "'yes' without a pixel inside the image"
    return None

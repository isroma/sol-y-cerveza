"""The leaf-off season as Sentinel-2 sees it this year (ADR-0007, #526).

The app uses the leaf-off horizons while Badajoz's deciduous trees are bare. Fixed dates are wrong
most years: in 2024 and 2025 the crowns were half bare around 1 December, in 2026 by 19 November,
and in spring they leafed out again between early April and May. So each build measures the
crowns in the latest clear Sentinel-2 scenes and writes the dates it saw into ``terraces.json``
(``leaf_off_from``, ``leaf_off_until``); the app falls back to fixed dates without them.

Measure (``leaf_loss``): over the 10 m pixels where the leaf-off model lowered most of the crowns
(``deciduous_pixels``), the median NDVI minus that of evergreen crowns the model keeps
(``evergreen_pixels``). The difference cancels haze and light that dim both. It is scaled between
the same difference in the summer composite (0, in leaf) and the winter one (1, bare) that the
leaf-off model was built from.

Dates (``leaf_off_dates``): the start is the second of the first two clear scenes in a row, from
``AUTUMN_FROM``, at least ``THRESHOLD`` bare; the end is the second of the first two in a row,
from ``SPRING_FROM``, less than ``THRESHOLD`` bare. Two in a row, because a single scene can be
off by 0.2 (thin cloud the scene classification missed). Neither is looked for after the dates the
app falls back to anyway (``AUTUMN_UNTIL``, ``SPRING_UNTIL``).

``observe`` is the fetch stage: it reads scenes from the public ``sentinel-cogs`` bucket (as
``solycerveza.leafoff`` does) and caches each scene's measurement in ``.cache/`` (a few numbers,
not the imagery), so a build reads only the scenes it hasn't seen.
"""

import json
import logging
import re
import warnings
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import httpx
import numpy as np
import numpy.typing as npt
import rasterio
import rasterio.errors
from rasterio.enums import Resampling
from rasterio.warp import reproject

from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.leafoff import (
    CLEAR_SCL,
    S2_CRS,
    BandReader,
    S2Window,
    deciduous_mask,
    list_scenes,
    read_band,
    s2_window,
)
from solycerveza.venues import CACHE_DIR

log = logging.getLogger(__name__)

THRESHOLD = 0.4
# Month-day windows in which the dates are looked for. The app falls back to the ends anyway:
# leaf-off from 1 December at the latest, until 15 April at the latest.
AUTUMN_FROM, AUTUMN_UNTIL = (10, 1), (12, 1)
SPRING_FROM, SPRING_UNTIL = (3, 1), (4, 15)
# A scene counts when at least this share of the deciduous pixels is clear.
MIN_CLEAR = 0.8
# Of a 10 m pixel's 2 m cells, at least this share lowered (deciduous) or kept tall (evergreen).
MIN_COVER = 0.5
EVERGREEN_MIN_NDVI = 0.5
EVERGREEN_MAX_CHANGE = 0.05
TALL_M = 2.5
MEASURES_CACHE = CACHE_DIR / "sentinel2_leaf_loss.json"

_SCENE_DATE = re.compile(r"_(\d{4})(\d{2})(\d{2})_")

BoolArray = npt.NDArray[np.bool_]
FloatArray = npt.NDArray[np.floating]


@dataclass(frozen=True)
class SceneLoss:
    """How bare the deciduous crowns were in one clear scene: 0 in leaf, 1 bare."""

    day: date
    loss: float


@dataclass(frozen=True)
class Masks:
    """The pixels compared, on the Sentinel-2 window, and the composite's reference gaps."""

    deciduous: BoolArray
    evergreen: BoolArray
    summer_gap: float
    winter_gap: float


def leaf_loss(deciduous_ndvi: float, evergreen_ndvi: float, masks: Masks) -> float:
    """0 when the gap is the summer composite's, 1 when it is the winter one's."""
    gap = deciduous_ndvi - evergreen_ndvi
    return (masks.summer_gap - gap) / (masks.summer_gap - masks.winter_gap)


def _confirmed(
    losses: Sequence[SceneLoss], start: date, end: date, hit: Callable[[float], bool]
) -> date | None:
    """The second of the first two scenes in a row in ``[start, end]`` where ``hit`` holds."""
    previous = False
    for scene in sorted(losses, key=lambda s: s.day):
        if not start <= scene.day <= end:
            continue
        now = hit(scene.loss)
        if now and previous:
            return scene.day
        previous = now
    return None


def leaf_off_dates(losses: Sequence[SceneLoss], today: date) -> tuple[date | None, date | None]:
    """The leaf-off start and end seen by ``today`` in the season ``today`` belongs to.

    A season runs from July to June: ``today`` in November looks at this autumn; in March, at
    last autumn and this spring.
    """
    autumn = today.year if today.month >= 7 else today.year - 1
    seen = [s for s in losses if s.day <= today]
    start = _confirmed(
        seen,
        date(autumn, *AUTUMN_FROM),
        date(autumn, *AUTUMN_UNTIL),
        lambda loss: loss >= THRESHOLD,
    )
    end = _confirmed(
        seen,
        date(autumn + 1, *SPRING_FROM),
        date(autumn + 1, *SPRING_UNTIL),
        lambda loss: loss < THRESHOLD,
    )
    return start, end


def scene_day(scene: str) -> date:
    match = _SCENE_DATE.search(scene)
    if match is None:
        raise ValueError(f"no date in scene id {scene}")
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _months(start: date, end: date) -> list[tuple[int, int]]:
    """(year, month) of every month from ``start`` to ``end``."""
    months: list[tuple[int, int]] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append((year, month))
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def search_windows(today: date) -> list[tuple[date, date]]:
    """The date ranges whose scenes ``leaf_off_dates`` needs on ``today`` (may be none)."""
    autumn = today.year if today.month >= 7 else today.year - 1
    windows = [
        (date(autumn, *AUTUMN_FROM), date(autumn, *AUTUMN_UNTIL)),
        (date(autumn + 1, *SPRING_FROM), date(autumn + 1, *SPRING_UNTIL)),
    ]
    return [(start, min(end, today)) for start, end in windows if start <= today]


def _to_window(
    grid: npt.NDArray[np.float32], transform: object, crs: object, window: S2Window
) -> FloatArray:
    out = np.zeros(window.shape, dtype=np.float32)
    reproject(
        grid,
        out,
        src_transform=transform,
        src_crs=crs,
        dst_transform=window.transform,
        dst_crs=S2_CRS,
        resampling=Resampling.average,
    )
    return out


def comparison_masks(
    ndvi_path: Path, dsm_path: Path, dtm_path: Path, leafoff_path: Path, window: S2Window
) -> Masks:
    """Deciduous and evergreen pixels on the Sentinel-2 window, from the leaf-off model."""
    with rasterio.open(ndvi_path) as src:
        if src.transform != window.transform or src.shape != window.shape:
            raise ValueError(f"{ndvi_path} is not on the Sentinel-2 window")
        summer = src.read(1).astype(np.float64)
        winter = src.read(2).astype(np.float64)
    with (
        rasterio.open(dsm_path) as dsm,
        rasterio.open(dtm_path) as dtm,
        rasterio.open(leafoff_path) as bare,
    ):
        surface = dsm.read(1).astype(np.float64)
        terrain = dtm.read(1).astype(np.float64)
        lowered = np.nan_to_num(surface - bare.read(1).astype(np.float64)) > 0.01
        tall_kept = ((surface - terrain) >= TALL_M) & ~lowered
        transform, crs = dsm.transform, dsm.crs
    deciduous = (
        _to_window(lowered.astype(np.float32), transform, crs, window) >= MIN_COVER
    ) & deciduous_mask(summer, winter)
    with np.errstate(invalid="ignore"):
        evergreen = (
            (_to_window(tall_kept.astype(np.float32), transform, crs, window) >= MIN_COVER)
            & (summer >= EVERGREEN_MIN_NDVI)
            & (np.abs(summer - winter) < EVERGREEN_MAX_CHANGE)
        )
    if not deciduous.any() or not evergreen.any():
        raise ValueError("no deciduous or no evergreen crowns to compare")
    return Masks(
        deciduous=deciduous,
        evergreen=evergreen,
        summer_gap=float(np.nanmedian(summer[deciduous]) - np.nanmedian(summer[evergreen])),
        winter_gap=float(np.nanmedian(winter[deciduous]) - np.nanmedian(winter[evergreen])),
    )


def measure_scene(
    scene: str, window: S2Window, masks: Masks, read: BandReader
) -> dict[str, float] | None:
    """Median NDVI of the deciduous and evergreen pixels; None when the scene isn't clear."""
    clear = np.isin(read(scene, "SCL", window), CLEAR_SCL)
    if float(clear[masks.deciduous].mean()) < MIN_CLEAR or not (clear & masks.evergreen).any():
        return None
    red, nir = read(scene, "B04", window), read(scene, "B08", window)
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = np.where(clear & (red > 0) & (nir > 0), (nir - red) / (nir + red), np.nan)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN medians become NaN
        deciduous = float(np.nanmedian(ndvi[masks.deciduous]))
        evergreen = float(np.nanmedian(ndvi[masks.evergreen & clear]))
    if not (np.isfinite(deciduous) and np.isfinite(evergreen)):
        return None
    return {"deciduous": round(deciduous, 4), "evergreen": round(evergreen, 4)}


def observe(
    today: date,
    masks: Masks,
    *,
    cache: Path = MEASURES_CACHE,
    read: BandReader = read_band,
    workers: int = 8,
) -> list[SceneLoss]:
    """Leaf loss in every clear scene ``leaf_off_dates`` needs on ``today``, scenes cached.

    Raises:
        httpx.HTTPError: If the bucket can't be listed.
        rasterio.errors.RasterioIOError: If a scene can't be read.
    """
    window = s2_window(BADAJOZ_BBOX)
    measured: dict[str, dict[str, float] | None] = (
        json.loads(cache.read_text(encoding="utf-8")) if cache.exists() else {}
    )
    scenes: list[str] = []
    with httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0)) as client:
        for start, end in search_windows(today):
            for year, month in _months(start, end):
                scenes += [
                    s for s in list_scenes(year, (month,), client) if start <= scene_day(s) <= end
                ]
    # Today's scenes may still be processing: measure only those from before today.
    todo = [s for s in scenes if s not in measured and scene_day(s) < today]
    if todo:
        log.info("measuring leaf loss in %d new Sentinel-2 scenes", len(todo))
        with ThreadPoolExecutor(workers) as pool:
            for scene, result in zip(
                todo, pool.map(lambda s: measure_scene(s, window, masks, read), todo), strict=True
            ):
                measured[scene] = result
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(measured, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    losses: dict[date, SceneLoss] = {}
    for scene in scenes:
        values = measured.get(scene)
        if values is None:
            continue
        loss = SceneLoss(
            scene_day(scene), leaf_loss(values["deciduous"], values["evergreen"], masks)
        )
        # Two satellites can pass the same day: keep one scene per day, deterministically.
        losses.setdefault(loss.day, loss)
    return sorted(losses.values(), key=lambda s: s.day)


def in_season(day: date, today: date) -> bool:
    """Whether ``day`` lies in a search window of the season ``today`` belongs to."""
    return any(start <= day <= end for start, end in search_windows(today))


def previous_dates(path: Path, today: date) -> tuple[date | None, date | None]:
    """The dates an earlier ``terraces.json`` holds, when they belong to ``today``'s season.

    For a build that can't reach Sentinel-2: it keeps what an earlier build saw instead of
    falling back to the fixed dates.
    """
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except OSError, ValueError:
        return None, None
    found: list[date | None] = []
    for key in ("leaf_off_from", "leaf_off_until"):
        value = data.get(key)
        try:
            day = date.fromisoformat(value) if isinstance(value, str) else None
        except ValueError:
            day = None
        found.append(day if day is not None and in_season(day, today) else None)
    return found[0], found[1]


def observed_dates(
    today: date,
    ndvi_path: Callable[[], Path],
    dsm_path: Path,
    dtm_path: Path,
    leafoff_path: Path,
    previous: Path,
) -> tuple[date | None, date | None]:
    """``leaf_off_dates`` from Sentinel-2, or ``previous_dates`` when Sentinel-2 can't be read.

    ``ndvi_path`` gives the summer/winter composite (``leafoff.load_ndvi``), which it may have to
    download.
    """
    try:
        masks = comparison_masks(
            ndvi_path(), dsm_path, dtm_path, leafoff_path, s2_window(BADAJOZ_BBOX)
        )
        return leaf_off_dates(observe(today, masks), today)
    except (httpx.HTTPError, rasterio.errors.RasterioIOError, OSError, ValueError) as error:
        log.warning("leaf-off dates: Sentinel-2 not read (%s); keeping the earlier ones", error)
        return previous_dates(previous, today)

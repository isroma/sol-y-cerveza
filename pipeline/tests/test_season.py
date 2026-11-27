import json
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import pytest

import solycerveza.season as season
from solycerveza.geo import BADAJOZ_BBOX
from solycerveza.leafoff import BandReader, S2Window, s2_window
from solycerveza.season import (
    THRESHOLD,
    Masks,
    SceneLoss,
    leaf_loss,
    leaf_off_dates,
    measure_scene,
    observe,
    previous_dates,
    scene_day,
    search_windows,
)

WINDOW = s2_window(BADAJOZ_BBOX)
ROWS, COLS = WINDOW.shape
# The left half deciduous, the right half evergreen; summer gap 0, winter gap -0.3.
DECIDUOUS = np.zeros(WINDOW.shape, dtype=bool)
DECIDUOUS[:, : COLS // 2] = True
MASKS = Masks(deciduous=DECIDUOUS, evergreen=~DECIDUOUS, summer_gap=0.0, winter_gap=-0.3)

BARE, LEAFY = THRESHOLD + 0.1, THRESHOLD - 0.1


def _scenes(*pairs: tuple[str, float]) -> list[SceneLoss]:
    return [SceneLoss(date.fromisoformat(day), loss) for day, loss in pairs]


def test_leaf_loss_runs_from_the_summer_gap_to_the_winter_gap() -> None:
    assert leaf_loss(0.7, 0.7, MASKS) == pytest.approx(0.0)
    assert leaf_loss(0.4, 0.7, MASKS) == pytest.approx(1.0)
    assert leaf_loss(0.55, 0.7, MASKS) == pytest.approx(0.5)
    # Haze that dims both leaves the loss alone.
    assert leaf_loss(0.45, 0.6, MASKS) == pytest.approx(0.5)


def test_leaf_off_starts_on_the_second_bare_scene_in_a_row() -> None:
    losses = _scenes(
        ("2026-10-25", BARE),  # one noisy scene alone doesn't count
        ("2026-11-04", LEAFY),
        ("2026-11-19", BARE),
        ("2026-11-23", BARE),
        ("2026-11-26", BARE),
    )
    assert leaf_off_dates(losses, date(2026, 11, 27)) == (date(2026, 11, 23), None)


def test_leaf_off_dates_only_use_scenes_up_to_today() -> None:
    losses = _scenes(("2026-11-19", BARE), ("2026-11-23", BARE))
    assert leaf_off_dates(losses, date(2026, 11, 20)) == (None, None)


def test_leaf_off_ends_on_the_second_leafy_scene_in_a_row_in_spring() -> None:
    losses = _scenes(
        ("2025-11-21", BARE),
        ("2025-11-26", BARE),
        ("2026-02-14", LEAFY),  # before 1 March: not looked at
        ("2026-02-19", LEAFY),
        ("2026-04-03", LEAFY),
        ("2026-04-05", BARE),
        ("2026-04-10", LEAFY),
        ("2026-04-12", LEAFY),
    )
    assert leaf_off_dates(losses, date(2026, 5, 1)) == (date(2025, 11, 26), date(2026, 4, 12))


def test_nothing_is_looked_for_past_the_fixed_dates() -> None:
    losses = _scenes(("2026-12-02", BARE), ("2026-12-05", BARE))
    assert leaf_off_dates(losses, date(2026, 12, 10)) == (None, None)


def test_a_season_runs_from_july_to_june() -> None:
    last_autumn = _scenes(("2025-11-21", BARE), ("2025-11-26", BARE))
    assert leaf_off_dates(last_autumn, date(2026, 6, 30))[0] == date(2025, 11, 26)
    assert leaf_off_dates(last_autumn, date(2026, 7, 1))[0] is None


def test_search_windows_follow_today() -> None:
    assert search_windows(date(2026, 9, 15)) == []
    assert search_windows(date(2026, 11, 27)) == [(date(2026, 10, 1), date(2026, 11, 27))]
    assert search_windows(date(2027, 3, 20)) == [
        (date(2026, 10, 1), date(2026, 12, 1)),
        (date(2027, 3, 1), date(2027, 3, 20)),
    ]


def test_scene_day_reads_the_id() -> None:
    assert scene_day("S2C_29SPD_20261123_0_L2A") == date(2026, 11, 23)
    with pytest.raises(ValueError, match="no date"):
        scene_day("S2C_29SPD_L2A")


def _reader(ndvi_deciduous: float, ndvi_evergreen: float, clear: bool = True) -> BandReader:
    """A scene with the given NDVI on each half (red fixed at 100)."""

    def read(_scene: str, band: str, _window: object) -> npt.NDArray[np.float64]:
        if band == "SCL":
            return np.full(WINDOW.shape, 4.0 if clear else 9.0)
        if band == "B04":
            return np.full(WINDOW.shape, 100.0)
        nir = np.where(DECIDUOUS, ndvi_deciduous, ndvi_evergreen)
        return np.asarray(100.0 * (1 + nir) / (1 - nir), dtype=np.float64)

    return read


def test_measure_scene_gives_the_median_ndvi_of_each_group() -> None:
    measured = measure_scene("S", WINDOW, MASKS, _reader(0.5, 0.7))
    assert measured is not None
    assert measured["deciduous"] == pytest.approx(0.5)
    assert measured["evergreen"] == pytest.approx(0.7)


def test_measure_scene_skips_cloudy_scenes() -> None:
    assert measure_scene("S", WINDOW, MASKS, _reader(0.5, 0.7, clear=False)) is None


def test_observe_measures_new_scenes_once_and_caches_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    scenes = {
        (2026, 10): ["S2B_29SPD_20261004_0_L2A"],
        (2026, 11): ["S2C_29SPD_20261123_0_L2A", "S2C_29SPD_20261127_0_L2A"],
    }
    monkeypatch.setattr(season, "list_scenes", lambda y, ms, _c: scenes.get((y, ms[0]), []))
    cache = tmp_path / "losses.json"
    read_calls: list[str] = []

    def read(scene: str, band: str, window: S2Window) -> npt.NDArray[np.floating[Any]]:
        read_calls.append(scene)
        return _reader(0.55, 0.7)(scene, band, window)

    losses = observe(date(2026, 11, 27), MASKS, cache=cache, read=read, workers=1)

    # Today's scene may still be processing: not measured yet.
    assert [s.day for s in losses] == [date(2026, 10, 4), date(2026, 11, 23)]
    assert losses[0].loss == pytest.approx(0.5)
    assert set(json.loads(cache.read_text())) == {
        "S2B_29SPD_20261004_0_L2A",
        "S2C_29SPD_20261123_0_L2A",
    }
    read_calls.clear()
    assert observe(date(2026, 11, 27), MASKS, cache=cache, read=read, workers=1) == losses
    assert read_calls == []


def test_previous_dates_keep_this_season_only(tmp_path: Path) -> None:
    path = tmp_path / "terraces.json"
    path.write_text(json.dumps({"leaf_off_from": "2026-11-23"}))
    assert previous_dates(path, date(2026, 11, 28)) == (date(2026, 11, 23), None)
    assert previous_dates(path, date(2027, 11, 28)) == (None, None)
    assert previous_dates(tmp_path / "missing.json", date(2026, 11, 28)) == (None, None)
    path.write_text(json.dumps({"leaf_off_from": "not a date"}))
    assert previous_dates(path, date(2026, 11, 28)) == (None, None)

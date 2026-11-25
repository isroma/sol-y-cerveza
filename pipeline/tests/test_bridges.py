import numpy as np
import pytest
from affine import Affine
from pyproj import Transformer
from rasterio.features import rasterize
from shapely.geometry import Polygon, box

from solycerveza.bridges import (
    AUTONOMIA,
    BRIDGE_WAYS,
    CABLES_PER_FAN,
    PALMAS,
    REAL,
    UNIVERSIDAD,
    Deck,
    apply,
    autonomia,
    outlines,
    palmas,
    real,
    universidad,
)
from solycerveza.buildings import Building, Measured
from solycerveza.obstacles import Grid

# A 2 m grid in UTM 29N, in Badajoz: 400 m east-west by 120 m.
X0, Y1 = 676000.0, 4304000.0
GRID = Grid("EPSG:25829", Affine(2.0, 0, X0, 0, -2.0, Y1), 200, 60)
TO_WGS84 = Transformer.from_crs(GRID.crs, "EPSG:4326", always_xy=True)
TO_GRID = Transformer.from_crs("EPSG:4326", GRID.crs, always_xy=True)
RIVER = 160.0
DECK_TOP = 172.0  # 12 m over the river
# The deck: 300 m long, 20 m wide, across the middle of the grid.
OUTLINE = box(X0 + 50, Y1 - 70, X0 + 350, Y1 - 50)


def rasters(pylon: bool = False) -> tuple[np.ndarray, np.ndarray]:
    terrain = np.full((GRID.height, GRID.width), RIVER)
    surface = terrain.copy()
    deck = rasterize([(OUTLINE, 1)], out_shape=surface.shape, transform=GRID.transform)
    surface[deck == 1] = DECK_TOP
    if pylon:  # a 70 m mast two thirds of the way along
        surface[29:31, 133:135] = RIVER + 70
    return surface, terrain


def test_outlines_need_every_bridge_closed() -> None:
    xs, ys = OUTLINE.exterior.xy
    lons, lats = TO_WGS84.transform(list(xs), list(ys))
    geometry = [{"lon": lo, "lat": la} for lo, la in zip(lons, lats, strict=True)]
    data = {"elements": [{"type": "way", "id": i, "geometry": geometry} for i in BRIDGE_WAYS]}
    shapes = outlines(data, TO_GRID)
    assert set(shapes) == set(BRIDGE_WAYS)
    assert shapes[REAL].area == pytest.approx(OUTLINE.area, rel=1e-3)
    with pytest.raises(ValueError, match=str(REAL)):
        outlines({"elements": data["elements"][:3]}, TO_GRID)


def test_a_deck_is_flat_over_the_river_and_meets_the_streets() -> None:
    surface, terrain = rasters()
    deck = Deck(OUTLINE, surface, terrain, GRID)
    assert deck.length == pytest.approx(300)
    assert deck.width == pytest.approx(20)
    assert deck.full == pytest.approx(12.0, abs=0.1)
    assert deck.h(150) == pytest.approx(deck.full)
    assert deck.h(0) == 0.0 and deck.h(300) == 0.0
    assert 0 < deck.h(45) < deck.full  # easing down over the 90 m ramps


def test_ramps_and_runs_on_are_per_end() -> None:
    surface, terrain = rasters()
    deck = Deck(OUTLINE, surface, terrain, GRID, ramps=(170.0, 110.0), extend=(45.0, 10.0))
    west, east = (0.0, 300.0) if deck.o[0] < deck.at(300)[0] else (300.0, 0.0)
    step = 1.0 if west == 0.0 else -1.0
    assert deck.h(west - step * 45) == 0.0  # 45 m on past the west end
    assert deck.h(west) > 0.0
    assert deck.h(east + step * 10) == 0.0
    # The west ramp is the longer: 100 m in, it is still lower than 100 m in from the east.
    assert deck.h(west + step * 100) < deck.h(east - step * 100)


def test_the_bridges_stand_on_their_decks() -> None:
    surface, terrain = rasters()
    deck = Deck(OUTLINE, surface, terrain, GRID)
    for bands in (palmas(deck), universidad(deck), autonomia(deck)):
        assert bands
        assert all(0.0 <= base < top <= deck.full + 1.1 for base, top, _ in bands)
        assert all(OUTLINE.buffer(3).contains(p) for _, _, p in bands)
    # Puente de Palmas: a pointed (six-sided) pier between each two of its 32 arches, where
    # the deck stands high enough over the river for one (not on the ramps' last metres).
    piers = [p for base, _, p in palmas(deck) if base == 0.0 and len(p.exterior.coords) == 7]
    span = deck.length / 32
    assert len(piers) == sum(deck.h(k * span) - 1.3 >= 1.0 for k in range(1, 32))
    assert 25 <= len(piers) <= 31


def test_puente_real_pylon_and_cables_are_a_mesh() -> None:
    surface, terrain = rasters(pylon=True)
    deck = Deck(OUTLINE, surface, terrain, GRID)
    bands, mesh = real(deck, surface, terrain, GRID)
    assert bands and max(top for _, top, _ in bands) < 20  # no pylon among the extrusions
    beams = 2 + 1 + 1 + 4 * CABLES_PER_FAN  # legs, mast, cross beam, cables
    assert len(mesh["triangles"]) == beams * 12 * 9
    heights = mesh["triangles"][2::3]
    assert max(heights) == pytest.approx(70, abs=1.5)
    assert min(heights) == pytest.approx(0, abs=0.5)
    lon, lat = mesh["origin"]
    x, _ = TO_GRID.transform(lon, lat)
    assert x == pytest.approx(X0 + 268, abs=4)  # at the mast


def test_apply_draws_the_four_and_clears_their_decks() -> None:
    surface, terrain = rasters(pylon=True)
    on_deck = Measured(
        Building("way/1", box(X0 + 100, Y1 - 65, X0 + 104, Y1 - 55), None), 12, "lidar"
    )
    ashore = Measured(Building("way/2", box(X0 + 10, Y1 - 20, X0 + 20, Y1 - 10), None), 8, "lidar")
    shapes: dict[int, Polygon] = {i: OUTLINE for i in (PALMAS, UNIVERSIDAD, AUTONOMIA, REAL)}
    kept, bands, mesh = apply([on_deck, ashore], shapes, surface, terrain, GRID)
    assert kept == [ashore]
    assert bands and mesh["triangles"]
    assert len(mesh["decks"]) == 4
    ring = mesh["decks"][0][0]
    assert ring[0] == ring[-1] and len(ring) >= 4

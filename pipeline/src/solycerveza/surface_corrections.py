"""Reviewed corrections to the LiDAR surface model (``data/surface_corrections.geojson``).

The 2 m surface model is from 2018-19 and has the odd artefact. Each correction is an area in
WGS84, checked by hand against the PNOA aerial photos, with a ``kind`` and a ``reason``:

- ``ground``: nothing stands there (a LiDAR artefact, or trees gone since the flight). The
  surface model is set to the terrain inside it (``flatten``, run by ``obstacles``), so terraces'
  horizons, the tree crowns and the buildings all follow.
- ``structure``: something built that OSM doesn't map, which the tree crowns would draw as a
  tree. ``trees`` leaves it out and ``buildings`` draws it as a building at its LiDAR height.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import numpy.typing as npt
import shapely
from affine import Affine
from pyproj import Transformer
from rasterio.features import geometry_mask
from shapely.geometry import Polygon, shape

CORRECTIONS_PATH = Path(__file__).resolve().parents[2] / "data" / "surface_corrections.geojson"

Kind = Literal["ground", "structure"]
KINDS: tuple[Kind, ...] = ("ground", "structure")


@dataclass(frozen=True)
class Correction:
    kind: Kind
    reason: str
    area: Polygon  # WGS84


def load_corrections(path: Path = CORRECTIONS_PATH) -> list[Correction]:
    """The corrections in ``path``; a feature that isn't a polygon of a known kind is an error."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: list[Correction] = []
    for i, feature in enumerate(data.get("features", [])):
        properties = feature.get("properties") or {}
        kind, reason = properties.get("kind"), properties.get("reason")
        area = shape(feature.get("geometry"))
        if kind not in KINDS or not isinstance(reason, str) or not reason:
            raise ValueError(f"{path}: feature {i} needs a kind in {KINDS} and a reason")
        if not isinstance(area, Polygon) or not area.is_valid or area.is_empty:
            raise ValueError(f"{path}: feature {i} is not a valid polygon")
        out.append(Correction(kind, reason, area))
    return out


def areas(corrections: list[Correction], kind: Kind, crs: str) -> list[Polygon]:
    """The ``kind`` areas, in ``crs``."""
    to_crs = Transformer.from_crs("EPSG:4326", crs, always_xy=True)

    def project(xy: npt.NDArray[np.float64]) -> npt.NDArray[np.float64]:
        return np.column_stack(to_crs.transform(xy[:, 0], xy[:, 1]))

    out: list[Polygon] = []
    for c in corrections:
        if c.kind == kind:
            projected = shapely.transform(c.area, project)
            if isinstance(projected, Polygon):
                out.append(projected)
    return out


def flatten(
    surface: npt.NDArray[np.float32],
    terrain: npt.NDArray[np.float32],
    ground: list[Polygon],
    transform: Affine,
    nodata: float,
) -> tuple[npt.NDArray[np.float32], int]:
    """``surface`` with the cells inside ``ground`` set to ``terrain`` (where it has data), and how
    many cells changed."""
    if not ground:
        return surface, 0
    inside = geometry_mask(
        ground, out_shape=surface.shape, transform=transform, invert=True, all_touched=True
    )
    change = inside & (terrain != nodata) & (surface != nodata)
    out = surface.copy()
    out[change] = terrain[change]
    return out, int(change.sum())

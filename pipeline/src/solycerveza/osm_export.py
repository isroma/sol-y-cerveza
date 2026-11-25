"""Batch the admin's venue reviews into an OSM change file to check and upload in JOSM.

`python -m solycerveza.osm_export` reads `pipeline/data/venue_review.csv`, fetches the current
OSM state of the reviewed venues from Overpass, and writes `pipeline/.cache/osm-review.osm`, a
JOSM file that holds only what OSM still lacks:

- OSM venues reviewed as `terrace` / `no_terrace` get `outdoor_seating=yes` / `no`.
- OSM venue nodes whose position was corrected are moved (ways and their nodes never are).
- A terrace placed more than `SEPARATE_TERRACE_M` from its venue becomes a new
  `leisure=outdoor_seating` node, unless OSM already has one within `EXISTING_SEATING_M`.
- Venues from other sources (Overture, Junta, `review:`) go to OSM only when named with `--add`,
  after a survey: their source licences don't allow copying them into OSM, a survey does. They
  become `amenity=<kind>` nodes with their name, unless OSM already has that name nearby.

Nothing is uploaded from here. The file is checked and uploaded by a person, under their own OSM
account, in JOSM; OSM treats that as normal mapping, not an automated edit. Running it again is
safe: anything OSM already has is left out, so a batch holds only new changes.
"""

import argparse
import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from xml.etree import ElementTree

import httpx
from pydantic import BaseModel, Field

from solycerveza.geo import distance_m
from solycerveza.review import REVIEW_CSV, Review, read_review
from solycerveza.venues import CACHE_DIR, LatLon, fetch_overpass

logger = logging.getLogger(__name__)

TERRACES_JSON = Path(__file__).resolve().parents[3] / "web" / "public" / "data" / "terraces.json"
OUTPUT = CACHE_DIR / "osm-review.osm"

#: Closer than this, a position change is noise, not a correction.
MOVE_THRESHOLD_M = 2.0
#: A terrace farther than this from its venue gets its own seating node.
SEPARATE_TERRACE_M = 5.0
#: An existing seating node this close to the terrace already marks it.
EXISTING_SEATING_M = 10.0
#: An existing venue with the same name this close means an added venue is already in OSM.
EXISTING_VENUE_M = 50.0

CHANGESET_COMMENT = "Badajoz: terrace positions and outdoor seating for bars and cafés"
CHANGESET_SOURCE = "survey;PNOA"


class OsmElement(BaseModel):
    """An element from an Overpass `out meta` response."""

    type: Literal["node", "way"]
    id: int
    version: int
    lat: float | None = None
    lon: float | None = None
    nodes: list[int] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)

    @property
    def location(self) -> LatLon | None:
        if self.lat is None or self.lon is None:
            return None
        return LatLon(lat=self.lat, lon=self.lon)


@dataclass(frozen=True)
class AddedVenue:
    """A non-OSM venue to create in OSM: its name, kind and position from `terraces.json`."""

    id: str
    name: str
    kind: str
    location: LatLon


@dataclass
class Change:
    """What one export changes, keyed for a deterministic file."""

    modified: dict[tuple[str, int], OsmElement] = field(default_factory=dict)
    created: list[dict[str, str | float]] = field(default_factory=list)
    context: dict[tuple[str, int], OsmElement] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.modified and not self.created


def osm_ref(venue_id: str) -> tuple[str, int] | None:
    """`osm:node/123` -> `("node", 123)`; other sources -> None."""
    if not venue_id.startswith("osm:"):
        return None
    kind, _, number = venue_id.removeprefix("osm:").partition("/")
    return kind, int(number)


def build_query(reviews: Sequence[Review], added: Sequence[AddedVenue]) -> str:
    """Overpass QL: the reviewed OSM elements (ways with their nodes), and the seating areas and
    named venues near each terrace and added venue."""
    nodes = sorted(ref[1] for r in reviews if (ref := osm_ref(r.venue_id)) and ref[0] == "node")
    ways = sorted(ref[1] for r in reviews if (ref := osm_ref(r.venue_id)) and ref[0] == "way")
    parts: list[str] = []
    if nodes:
        parts.append(f"  node(id:{','.join(map(str, nodes))});")
    if ways:
        parts.append(f"  way(id:{','.join(map(str, ways))});")
        parts.append(f"  node(w:{','.join(map(str, ways))});")
    for review in reviews:
        if review.terrace is not None:
            t = review.terrace
            around = f"around:{EXISTING_SEATING_M:.0f},{t.lat},{t.lon}"
            parts.append(f'  node({around})["leisure"="outdoor_seating"];')
    for venue in added:
        v = venue.location
        parts.append(f'  nwr(around:{EXISTING_VENUE_M:.0f},{v.lat},{v.lon})["amenity"]["name"];')
    return "[out:json][timeout:90];\n(\n" + "\n".join(parts) + "\n);\nout meta;\n"


def parse_elements(data: dict[str, object]) -> dict[tuple[str, int], OsmElement]:
    elements = data.get("elements", [])
    assert isinstance(elements, list)
    parsed = (OsmElement.model_validate(raw) for raw in elements)
    return {(e.type, e.id): e for e in parsed if e.type in ("node", "way")}


def plan(
    reviews: Sequence[Review],
    added: Sequence[AddedVenue],
    osm: dict[tuple[str, int], OsmElement],
) -> Change:
    """Turn reviews into the changes OSM still lacks."""
    change = Change()
    seating = [
        e for e in osm.values() if e.type == "node" and e.tags.get("leisure") == "outdoor_seating"
    ]
    added_by_id = {a.id: a for a in added}

    for review in sorted(reviews, key=lambda r: r.venue_id):
        ref = osm_ref(review.venue_id)
        if review.status == "not_venue":
            change.notes.append(
                f"{review.venue_id}: reviewed as not a venue; not changed in OSM (check on site)"
            )
            continue
        if ref is None:
            venue = added_by_id.get(review.venue_id)
            if venue is not None:
                _add_venue(change, review, venue, osm, seating)
            continue
        element = osm.get(ref)
        if element is None:
            change.notes.append(f"{review.venue_id}: not in OSM any more, skipped")
            continue
        updated = element.model_copy(deep=True)
        if review.status in ("terrace", "no_terrace"):
            updated.tags["outdoor_seating"] = "yes" if review.status == "terrace" else "no"
        position = element.location
        if (
            review.venue is not None
            and element.type == "node"
            and position is not None
            and distance_m(position, review.venue) > MOVE_THRESHOLD_M
        ):
            updated.lat, updated.lon = review.venue.lat, review.venue.lon
        if updated != element:
            change.modified[ref] = updated
            if element.type == "way":
                for node_id in element.nodes:
                    if ("node", node_id) in osm:
                        change.context[("node", node_id)] = osm[("node", node_id)]
        anchor = review.venue or position
        if review.terrace is not None and anchor is not None:
            _seating_node(change, seating, review.terrace, anchor, review.venue_id)
    missing = sorted(set(added_by_id) - {r.venue_id for r in reviews})
    for venue_id in missing:
        change.notes.append(f"{venue_id}: --add needs a review row, skipped")
    return change


def _seating_node(
    change: Change, seating: Sequence[OsmElement], terrace: LatLon, venue: LatLon, label: str
) -> None:
    """A new `leisure=outdoor_seating` node at a terrace away from its venue, unless OSM has one."""
    if distance_m(terrace, venue) <= SEPARATE_TERRACE_M:
        return
    near = [
        s for s in seating if s.location and distance_m(s.location, terrace) <= EXISTING_SEATING_M
    ]
    if near:
        change.notes.append(f"{label}: OSM already has outdoor seating there")
        return
    change.created.append({"lat": terrace.lat, "lon": terrace.lon, "leisure": "outdoor_seating"})


def _add_venue(
    change: Change,
    review: Review,
    venue: AddedVenue,
    osm: dict[tuple[str, int], OsmElement],
    seating: Sequence[OsmElement],
) -> None:
    if review.status not in ("terrace", "no_terrace"):
        change.notes.append(f"{venue.id}: needs a terrace / no terrace review to add, skipped")
        return
    location = review.venue or venue.location
    same_name = [
        e
        for e in osm.values()
        if e.tags.get("name", "").casefold() == venue.name.casefold()
        and e.location is not None
        and distance_m(e.location, location) <= EXISTING_VENUE_M
    ]
    if same_name:
        e = same_name[0]
        change.notes.append(f"{venue.id}: OSM already has {venue.name!r} as {e.type}/{e.id}")
        return
    change.created.append(
        {
            "lat": location.lat,
            "lon": location.lon,
            "amenity": venue.kind,
            "name": venue.name,
            "outdoor_seating": "yes" if review.status == "terrace" else "no",
        }
    )
    if review.terrace is not None:
        _seating_node(change, seating, review.terrace, location, venue.id)


def to_josm_xml(change: Change) -> str:
    """A JOSM `.osm` file: modified elements with `action="modify"`, new nodes with negative ids,
    and the unchanged nodes of modified ways so JOSM can load them."""
    root = ElementTree.Element("osm", version="0.6", generator="sol-y-cerveza", upload="true")

    def add(element: OsmElement, action: str | None) -> None:
        attrs = {"id": str(element.id), "version": str(element.version), "visible": "true"}
        if action:
            attrs["action"] = action
        if element.type == "node":
            assert element.lat is not None and element.lon is not None
            attrs |= {"lat": f"{element.lat:.7f}", "lon": f"{element.lon:.7f}"}
        node = ElementTree.SubElement(root, element.type, attrs)
        for ref in element.nodes:
            ElementTree.SubElement(node, "nd", ref=str(ref))
        for key in sorted(element.tags):
            ElementTree.SubElement(node, "tag", k=key, v=element.tags[key])

    for key in sorted(change.context.keys() - change.modified.keys()):
        add(change.context[key], None)
    for key in sorted(change.modified, key=lambda k: (k[0] != "node", k[1])):
        add(change.modified[key], "modify")
    for index, new in enumerate(change.created, start=1):
        node = ElementTree.SubElement(
            root,
            "node",
            id=str(-index),
            action="modify",
            visible="true",
            lat=f"{new['lat']:.7f}",
            lon=f"{new['lon']:.7f}",
        )
        for tag in sorted(k for k in new if k not in ("lat", "lon")):
            ElementTree.SubElement(node, "tag", k=tag, v=str(new[tag]))
    ElementTree.indent(root)
    return ElementTree.tostring(root, encoding="unicode", xml_declaration=True) + "\n"


def load_added(ids: Sequence[str], path: Path = TERRACES_JSON) -> list[AddedVenue]:
    """Name, kind and position of the `--add` venues, from the built `terraces.json`."""
    if not ids:
        return []
    records = json.loads(path.read_text(encoding="utf-8"))["terraces"]
    by_id = {r["id"]: r for r in records}
    added: list[AddedVenue] = []
    for venue_id in ids:
        if osm_ref(venue_id) is not None:
            raise ValueError(f"{venue_id} is already in OSM; --add is for other sources")
        record = by_id.get(venue_id)
        if record is None:
            raise ValueError(f"{venue_id} is not in {path}")
        added.append(
            AddedVenue(
                id=venue_id,
                name=record["name"],
                kind=record["kind"],
                location=LatLon.model_validate(record["venue"]),
            )
        )
    return added


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Write the venue reviews OSM still lacks as a JOSM file to check and upload."
    )
    parser.add_argument(
        "--add",
        action="append",
        default=[],
        metavar="VENUE_ID",
        help="also create this surveyed non-OSM venue (repeatable)",
    )
    parser.add_argument("--out", type=Path, default=OUTPUT, help="output .osm file")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

    reviews = [r for r in read_review(REVIEW_CSV) if r.status != "not_venue" or osm_ref(r.venue_id)]
    added = load_added(args.add)
    with httpx.Client(timeout=120) as client:
        raw = fetch_overpass(build_query(reviews, added), client=client)
    change = plan(reviews, added, parse_elements(json.loads(raw)))
    for note in change.notes:
        logger.info(note)
    if change.empty:
        logger.info("OSM already has every reviewed change: nothing to export")
        return 0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(to_josm_xml(change), encoding="utf-8")
    logger.info(
        "%d modified, %d new -> %s\nOpen it in JOSM, check each change, and upload with\n"
        "  comment=%s\n  source=%s",
        len(change.modified),
        len(change.created),
        args.out,
        CHANGESET_COMMENT,
        CHANGESET_SOURCE,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

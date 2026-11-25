"""Venues from the Junta de Extremadura register of restaurants and bars.

Source: "Establecimientos de restauración en Extremadura" (datos.gob.es
a11002926-establecimientos-de-restauracion-en-extremadura), CC BY 4.0, attribution "Junta de
Extremadura". It has names, kinds, opening dates and street addresses, but no coordinates and
no terrace field, and venues stay listed until the owner reports a closure.

So the register is used carefully (ADR-0004):
- every row is geocoded with CartoCiudad (IGN/CNIG, CC BY 4.0 ign.es), restricted to the
  municipality of Badajoz, and only exact street-number matches are kept;
- a row that matches an existing OSM/Overture venue only confirms it;
- an unmatched row becomes a venue only if it opened in MIN_OPENED_YEAR or later, because old
  unmatched rows are the likeliest to have closed.

Run `python -m solycerveza.junta` to download and geocode (cached in `.cache/`).
"""

import argparse
import csv
import hashlib
import io
import json
import logging
import re
import time
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import httpx

from solycerveza.overture import NearbyVenues, same_venue
from solycerveza.venues import CACHE_DIR, USER_AGENT, Kind, LatLon, Venue

logger = logging.getLogger(__name__)

REGISTER_URL = "https://www.juntaex.es/documents/77055/5801338/Restauracion.csv"
GEOCODER_URL = "https://www.cartociudad.es/geocoder/api/geocoder/candidates"
MIN_OPENED_YEAR = 2010
CITY_POSTCODES = frozenset(f"060{i:02d}" for i in range(13))
# Portal lookups. "v2": since #350 a portal outside the city's postcodes no longer counts, so
# answers cached before then (which may sit in a village of the municipality) are not reused.
PORTALS_CACHE = "cartociudad_portals_v2.json"

MODALIDAD_KINDS: dict[str, Kind] = {
    "Café - Bar": "bar",
    "Restaurante": "restaurant",
    "Cafetería": "cafe",
    "Pub": "pub",
}

STREET_TYPES = {
    r"^(C/\.?|C\.|CL\.?|CALLE)\s*": "CALLE ",
    r"^(AVDA\.?|AVD\.?|AV\.|AVENIDA|AVEDA\.?)\s*": "AVENIDA ",
    r"^(PZA\.?|PZ\.?|PL\.|PLAZA)\s*": "PLAZA ",
    r"^(CTRA\.?|CRTA\.?|CARRETERA)\s*": "CARRETERA ",
    r"^(URB\.?|URBANIZACION|URBANIZACIÓN)\s*": "URBANIZACION ",
    r"^(PSO\.?|PASEO)\s*": "PASEO ",
    r"^(RDA\.?|RONDA)\s*": "RONDA ",
    r"^(TRAV\.?|TRAVESIA|TRAVESÍA)\s*": "TRAVESIA ",
    r"^(BDA\.?|BARRIADA)\s*": "BARRIADA ",
}
TRAILING_PARTS = (
    r"\b(LOCAL|LOC\.|BAJO|BJ\.?|ESQ\.?|ESQUINA|C\.C\.|CC|CENTRO COMERCIAL|NAVE|BLOQUE|BLQ"
    r"|PORTAL|EDIF\.?|EDIFICIO|ENTREPLANTA|PLANTA)\b.*$"
)
# Lowercase inside names; articles stay capitalised ("Bar La Esquina").
SMALL_WORDS = frozenset({"de", "del", "y", "e", "a", "en"})


@dataclass(frozen=True)
class RegisterRow:
    name: str
    kind: Kind
    street: str
    number: str
    opened: date | None


def plain(text: str) -> str:
    text = unicodedata.normalize("NFD", text.upper())
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", text).split())


def split_address(address: str) -> tuple[str, str] | None:
    """("CALLE LAS LAVANDERAS", "1") from "C/ LAS LAVANDERAS, 1 - LOCAL D", or None."""
    text = " ".join(address.upper().split())
    for pattern, replacement in STREET_TYPES.items():
        if re.match(pattern, text):
            text = re.sub(pattern, replacement, text, count=1)
            break
    text = re.sub(r"\(.*?(\)|$)", "", text)
    text = re.sub(TRAILING_PARTS, "", text).strip(" ,-")
    match = re.match(r"^(.*?)[,\s]+(?:N[º°O]\.?\s*|NUM\.?\s*)?(\d+)\b", text)
    if not match or len(match.group(1)) <= 2 or re.search(r"\bK(M)?\.?$", match.group(1)):
        return None
    return match.group(1).strip(" ,"), match.group(2)


def street_core(street: str) -> str:
    text = re.sub(
        r"^(CALLE|AVENIDA|PLAZA|CARRETERA|URBANIZACION|PASEO|RONDA|TRAVESIA|BARRIADA)\s+",
        "",
        plain(street),
    )
    return " ".join(re.sub(r"\b(DE|DEL|LA|LAS|LOS|EL|Y)\b", " ", text).split())


ROMAN = re.compile(r"^[ivx]{1,4}$")
INITIALISM = re.compile(r"^([a-zñ]\.)+[a-zñ]?\.?$")


def title_name(name: str) -> str:
    """ "BAR LA ESQUINA DEL ARCO" -> "Bar La Esquina del Arco" (registers are in capitals).

    Roman numerals ("II") and initialisms ("S.I.M.A.G.O") stay in capitals.
    """
    words = name.strip().lower().split()
    out = []
    for i, w in enumerate(words):
        if (ROMAN.match(w) and i > 0) or INITIALISM.match(w):
            out.append(w.upper())
        elif i > 0 and w in SMALL_WORDS:
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def parse_register(text: str) -> list[RegisterRow]:
    """City rows of the kinds we list, with a street number."""
    rows: list[RegisterRow] = []
    for record in csv.DictReader(io.StringIO(text)):
        kind = MODALIDAD_KINDS.get(record["Modalidad"].strip())
        postcode = (record["C. Postal"] or "").strip().zfill(5)
        if record["Municipio"].strip().upper() != "BADAJOZ" or kind is None:
            continue
        if postcode not in CITY_POSTCODES:
            continue
        address = split_address(record["Dirección"])
        if address is None:
            continue
        try:
            opened: date | None = date.fromisoformat(record["exp_fecapertura"].strip())
        except ValueError:
            opened = None
        rows.append(
            RegisterRow(
                name=title_name(record["Nombre establecimiento"]),
                kind=kind,
                street=address[0],
                number=address[1],
                opened=opened,
            )
        )
    return rows


def pick_portal(candidates: Iterable[dict[str, Any]], street: str, number: str) -> LatLon | None:
    """The candidate at exactly this street number, if its street name matches well enough.

    It must be in the city: the municipality's villages (Valdebótoa, Gévora, ...) share street
    names with it, and a candidate there has a postcode outside `CITY_POSTCODES`.
    """
    target = street_core(street)
    for candidate in candidates:
        if candidate.get("type") != "portal" or str(candidate.get("portalNumber")) != number:
            continue
        postcode = str(candidate.get("postalCode") or "").strip()
        if postcode and postcode.zfill(5) not in CITY_POSTCODES:
            continue
        candidate_street = re.sub(r"\s\d+\w?$", "", str(candidate.get("address", "")).split(",")[0])
        if SequenceMatcher(None, target, street_core(candidate_street)).ratio() < 0.7:
            continue
        lat, lon = candidate.get("lat"), candidate.get("lng")
        if isinstance(lat, int | float) and isinstance(lon, int | float):
            return LatLon(lat=lat, lon=lon)
    return None


class Geocoder:
    """CartoCiudad portal lookups, cached on disk so rebuilds don't hit the service again."""

    def __init__(self, cache_file: Path, client: httpx.Client, delay_s: float = 0.25) -> None:
        self.cache_file = cache_file
        self.client = client
        self.delay_s = delay_s
        self.lookups = 0
        self.cache: dict[str, list[float] | None] = (
            json.loads(cache_file.read_text(encoding="utf-8")) if cache_file.exists() else {}
        )

    def portal(self, street: str, number: str) -> LatLon | None:
        key = f"{street}|{number}"
        if key not in self.cache:
            variants = (
                [street]
                if street.startswith(("CALLE", "AVENIDA", "PLAZA"))
                else [street, f"CALLE {street}"]
            )
            found: LatLon | None = None
            for variant in variants:
                answer = self._candidates(f"{variant} {number}")
                if answer is None:  # service failing: don't cache, retry on the next run
                    return None
                found = pick_portal(answer, street, number)
                if found:
                    break
            self.cache[key] = None if found is None else [found.lat, found.lon]
            self.lookups += 1
            if self.lookups % 50 == 0:
                self.save()
        cached = self.cache[key]
        return None if cached is None else LatLon(lat=cached[0], lon=cached[1])

    def _candidates(self, query: str, attempts: int = 4) -> list[dict[str, Any]] | None:
        """CartoCiudad candidates, retrying 5xx answers and dropped connections with backoff."""
        for attempt in range(attempts):
            try:
                response = self.client.get(
                    GEOCODER_URL,
                    params={"q": query, "municipio_filter": "Badajoz", "limit": "10"},
                )
                if response.status_code < 500:
                    response.raise_for_status()
                    time.sleep(self.delay_s)
                    answer = response.json() or []
                    return answer if isinstance(answer, list) else []
            except httpx.TransportError:
                pass
            time.sleep(self.delay_s * 4 * 2**attempt)
        logger.warning("CartoCiudad kept failing for %r", query)
        return None

    def save(self) -> None:
        self.cache_file.parent.mkdir(parents=True, exist_ok=True)
        # Atomic: an interrupted save must not leave a truncated cache that fails to parse.
        partial = self.cache_file.with_suffix(".part")
        partial.write_text(json.dumps(self.cache, sort_keys=True), encoding="utf-8")
        partial.replace(self.cache_file)


def register_id(row: RegisterRow) -> str:
    """Stable id from name and address (the register has no ids of its own)."""
    digest = hashlib.sha1(
        f"{plain(row.name)}|{plain(row.street)}|{row.number}".encode()
    ).hexdigest()
    return f"junta:{digest[:12]}"


def add_register_venues(
    venues: Sequence[Venue],
    rows: Iterable[tuple[RegisterRow, LatLon]],
    min_opened_year: int = MIN_OPENED_YEAR,
) -> tuple[list[Venue], int]:
    """Venues plus unmatched recent register rows, and how many existing venues were confirmed."""
    kept = NearbyVenues(venues)
    confirmed: set[str] = set()
    for row, location in rows:
        candidate = Venue(
            id=register_id(row),
            name=row.name,
            kind=row.kind,
            location=location,
            outdoor_seating=None,
        )
        match = next((v for v in kept.near(candidate.location) if same_venue(candidate, v)), None)
        if match is not None:
            confirmed.add(match.id)
            continue
        if row.opened is not None and row.opened.year >= min_opened_year:
            kept.add(candidate)
    return sorted(kept.venues, key=lambda venue: venue.id), len(confirmed)


def load_register(
    cache_dir: Path = CACHE_DIR, *, refresh: bool = False
) -> list[tuple[RegisterRow, LatLon]]:
    """Download (or reuse) the register and geocode its city rows to exact street numbers."""
    csv_path = cache_dir / "junta_restauracion.csv"
    headers = {"User-Agent": USER_AGENT}
    with httpx.Client(
        headers=headers, timeout=httpx.Timeout(60.0), follow_redirects=True
    ) as client:
        if refresh or not csv_path.exists():
            response = client.get(REGISTER_URL)
            response.raise_for_status()
            csv_path.parent.mkdir(parents=True, exist_ok=True)
            partial = csv_path.with_suffix(".part")
            partial.write_bytes(response.content)
            partial.replace(csv_path)
        rows = parse_register(csv_path.read_bytes().decode("latin-1"))
        geocoder = Geocoder(cache_dir / PORTALS_CACHE, client)
        located: list[tuple[RegisterRow, LatLon]] = []
        try:
            for row in rows:
                location = geocoder.portal(row.street, row.number)
                if location is not None:
                    located.append((row, location))
        finally:
            geocoder.save()
    logger.info(
        "Junta register: %d city rows, %d at an exact street number", len(rows), len(located)
    )
    return located


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download and geocode the Junta register.")
    parser.add_argument("--refresh", action="store_true", help="download the CSV again")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    load_register(refresh=args.refresh)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

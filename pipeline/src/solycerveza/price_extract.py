"""Beer prices in the text of a venue's web page. Pure: no network, no files.

Input is the page as lines (`solycerveza.websites.parse_html`: one line per block element,
table cells and definition-list items joined by tabs). Each line is split into segments at
`·`, `•`, `|`, `;` and ` / `, and a segment yields a price only when it is unambiguous:

- it names exactly one item: a caña (`caña`, not "caña de lomo"), or a tercio (`tercio`, or
  `33 cl`) of exactly one known brand (`BRAND_PATTERNS`). Under a short heading that says
  "tercios", a line with a brand and a price is a tercio too;
- it has exactly one price: decimals with a comma, dot or apostrophe ("1,50", "1.50", "1'50"),
  with or without "€"; whole euros only with "€" ("2 €"). Numbers followed by a unit ("33 cl",
  "4,8 %") are not prices; phone numbers and years never match;
- it mentions no other drink, size or variant (`EXCLUDED`): dobles, jarras, pintas, quintos,
  botellines, copas, wine, alcohol-free or flavoured beer, other brands' variants, offers;
- the price is between 0,50 € and 15,00 €.

Precision over recall: anything else is dropped. Each result keeps the segment as its snippet.
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from solycerveza.prices import Brand, Item
from solycerveza.websites import plain

MIN_CENTS = 50
MAX_CENTS = 1500
MAX_SNIPPET = 160

# Accent-free, lower-case patterns (see `plain`), matched on word boundaries.
BRAND_PATTERNS: dict[Brand, str] = {
    "cruzcampo": r"cruz ?campo",
    "mahou-5-estrellas": r"mahou(?: (?:5|cinco) estrellas)?",
    "estrella-galicia": r"estrella galicia",
    "amstel": r"amstel",
    "heineken": r"heineken",
    "alhambra-especial": r"alhambra(?: especial)?",
    "san-miguel": r"san miguel",
    "estrella-damm": r"estrella damm",
    "super-bock": r"super ?bock",
    "sagres": r"sagres",
}
BRAND_RES = {brand: re.compile(rf"\b{p}\b") for brand, p in BRAND_PATTERNS.items()}
ANY_BRAND = "|".join(BRAND_PATTERNS.values())

CANA = re.compile(r"\bcanas?\b")
# "Caña de lomo" is a cured loin; "caña de crema" a pastry. Only beer words may follow "de".
CANA_OF_SOMETHING = re.compile(r"\bcanas? de (?!cerveza\b|barril\b)")
TERCIO = re.compile(r"\btercios?\b")
# "Tercio de ibérico" is a portion of food.
TERCIO_OF_SOMETHING = re.compile(rf"\btercios? de (?!cerveza\b|(?:{ANY_BRAND})\b)")
THIRTY_THREE_CL = re.compile(r"(?<![\d.,])(?:33 ?cl|0[.,]33 ?l)\b")

# Words that make a segment about something else: other serving sizes, other drinks, beer
# variants that are not the brand's standard lager, and deals.
EXCLUDED = re.compile(
    r"\b(?:dobles?|jarras?|pintas?|tubos?|quintos?|botellin(?:es)?|minis?|litros?|cubos?"
    r"|tanques?|pack|caja|copas?|vinos?|tinto|blanco|rosado|rioja|ribera|verdejo|albarino|cava"
    r"|sangria|vermut|refrescos?|cafe|sin|tostada|radler|limon|clara|shandy|maestra|clasica"
    r"|reserva|1925|1906|roja|negra|ipa|oro|selecta|fresca|manila|stout|preta|black|artesanas?"
    r"|ultra|free|turia|voll|promo(?:cion)?|oferta|2x1|3x2|happy|menu|incluye|incluido)\b"
    r"|0[.,]0\b|\b(?:20|25|50) ?cl\b|\b1 ?l\b"
)

# A number that may be a price: 1 or 2 whole digits, optional decimals, optional euro sign.
# Decimal separators: comma, dot, and the apostrophes menus use ("1'50", "1\u00b450").
SEPARATORS = ".,'\u00b4\u2019"
NUMBER = re.compile(
    # Not glued to a word or another number ("924.22"); dot leaders ("Caña.....1,50") are fine.
    rf"(?P<pre>€\s*)?(?<![\w{SEPARATORS[1:]}])(?<![^.]\.)(?P<euros>\d{{1,2}})"
    rf"(?:(?P<sep>[{SEPARATORS}])(?P<dec>\d{{1,2}}))?(?![\d]|[{SEPARATORS}]\d)"
    r"(?P<post>\s*(?:€|eur(?:os?)?\b))?"
)
UNIT_AFTER = re.compile(
    r"^\s*(?:%|º|°|cl\b|ml\b|cc\b|l\b|lt\b|litros?\b|g\b|gr\b|kg\b|uds?\b|unidades\b|x\b"
    r"|h\b|horas?\b|min\b|personas?\b|pax\b|años?\b)",
    re.IGNORECASE,
)
SEGMENT_SPLIT = re.compile(r"[·•|;]| / ")


@dataclass(frozen=True)
class FoundPrice:
    item: Item
    brand: Brand | None
    cents: int
    snippet: str


def prices_in(segment: str) -> tuple[list[int], int]:
    """(valid prices in cents, count of every number that looks like a price) in `segment`."""
    valid: list[int] = []
    pricey = 0
    for match in NUMBER.finditer(segment):
        if UNIT_AFTER.match(segment[match.end() :]):
            continue
        euro = bool(match["pre"] or match["post"])
        dec = match["dec"]
        if dec is None and not euro:
            continue  # a bare whole number: a quantity, a size, part of a phone number...
        pricey += 1
        if dec is not None and len(dec) == 1 and not euro:
            continue  # "1,5" without a euro sign is too vague
        cents = int(match["euros"]) * 100 + int((dec or "0").ljust(2, "0"))
        valid.append(cents)
    return valid, pricey


def brands_in(text: str) -> set[Brand]:
    return {brand for brand, pattern in BRAND_RES.items() if pattern.search(text)}


def is_tercio_heading(line: str) -> bool:
    """A short line without prices that announces tercios ("Tercios", "Cervezas 33 cl")."""
    text = plain(line)
    return len(text) <= 60 and bool(TERCIO.search(text) or THIRTY_THREE_CL.search(text))


def segment_price(segment: str, tercio_section: bool) -> FoundPrice | None:
    """The one price `segment` states for a caña or a branded tercio, if it is unambiguous."""
    snippet = " ".join(segment.split())
    if not snippet or len(snippet) > MAX_SNIPPET:
        return None
    text = plain(snippet)
    if EXCLUDED.search(text) or CANA_OF_SOMETHING.search(text) or TERCIO_OF_SOMETHING.search(text):
        return None
    valid, pricey = prices_in(snippet)
    if pricey != 1 or len(valid) != 1:
        return None
    cents = valid[0]
    if not MIN_CENTS <= cents <= MAX_CENTS:
        return None
    is_cana = bool(CANA.search(text))
    is_tercio = bool(TERCIO.search(text) or THIRTY_THREE_CL.search(text))
    brands = brands_in(text)
    if is_cana and not is_tercio:
        return FoundPrice(item="cana", brand=None, cents=cents, snippet=snippet)
    if is_cana or len(brands) != 1:
        return None
    if is_tercio or tercio_section:
        return FoundPrice(item="tercio", brand=brands.pop(), cents=cents, snippet=snippet)
    return None


def extract_prices(lines: Sequence[str]) -> list[FoundPrice]:
    """Every unambiguous caña and tercio price in a page's lines, in page order, deduplicated."""
    found: list[FoundPrice] = []
    tercio_section = False
    for line in lines:
        if prices_in(line)[1] == 0:
            # A line without prices is a heading or prose: it opens or closes a tercio list.
            tercio_section = is_tercio_heading(line)
            continue
        for segment in SEGMENT_SPLIT.split(line):
            price = segment_price(segment.replace("\t", " "), tercio_section)
            if price is not None and price not in found:
                found.append(price)
    return found

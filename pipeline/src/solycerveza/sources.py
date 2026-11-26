"""All venue sources combined: OSM, then Overture (ADR-0003), then the Junta register (ADR-0004)."""

import logging
from pathlib import Path

from solycerveza.corrections import apply_corrections, read_corrections
from solycerveza.junta import add_register_venues, load_register
from solycerveza.overture import cache_path, fetch_places, merge_venues, read_places
from solycerveza.review import read_review
from solycerveza.venues import CACHE_DIR, Venue, load_venues

logger = logging.getLogger(__name__)


def load_all_venues(*, refresh: bool = False, cache_dir: Path = CACHE_DIR) -> list[Venue]:
    """Every venue, downloading what is not cached (or everything with `refresh`)."""
    places = cache_path(cache_dir)
    if refresh or not places.exists():
        fetch_places(cache_dir=cache_dir)
    reviewed = {r.venue_id for r in read_review()}
    venues = merge_venues(
        load_venues(cache_dir=cache_dir, refresh=refresh), read_places(places, reviewed)
    )
    venues, confirmed = add_register_venues(venues, load_register(cache_dir, refresh=refresh))
    venues = apply_corrections(venues, read_corrections())
    logger.info("Junta register confirms %d venues; %d venues in total", confirmed, len(venues))
    return venues

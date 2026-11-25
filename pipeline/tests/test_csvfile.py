from collections.abc import Callable
from pathlib import Path

import pytest
from pydantic import BaseModel

from solycerveza.corrections import CORRECTIONS_CSV, read_corrections
from solycerveza.csvfile import blank_to_none, read_rows
from solycerveza.price_candidates import CANDIDATES_CSV, read_candidates
from solycerveza.prices import PRICES_CSV, read_prices
from solycerveza.proposals import PROPOSALS_CSV, read_proposals
from solycerveza.review import REVIEW_CSV, read_review
from solycerveza.terraces import CURATED_CSV, read_curated


class Pair(BaseModel):
    a: str
    b: int | None = None


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "pairs.csv"
    path.write_text(text, encoding="utf-8")
    return path


def test_reads_rows_through_clean(tmp_path: Path) -> None:
    path = write(tmp_path, "a,b\n x ,2\ny,\nz\n")
    rows = read_rows(path, ("a", "b"), Pair, clean=blank_to_none)
    assert rows == [Pair(a="x", b=2), Pair(a="y"), Pair(a="z")]


def test_header_must_match_and_names_the_current_columns(tmp_path: Path) -> None:
    path = write(tmp_path, "b,a\n1,x\n")
    with pytest.raises(ValueError, match=r"pairs.csv: header must be a,b$"):
        read_rows(path, ("a", "b"), Pair, clean=blank_to_none)


def test_accepts_a_legacy_header(tmp_path: Path) -> None:
    path = write(tmp_path, "a\nx\n")
    with pytest.raises(ValueError, match="header must be a,b"):
        read_rows(path, ("a", "b"), Pair, clean=blank_to_none)
    rows = read_rows(path, ("a", "b"), Pair, clean=blank_to_none, legacy=[("a",)])
    assert rows == [Pair(a="x")]


def test_errors_name_the_line(tmp_path: Path) -> None:
    path = write(tmp_path, "a,b\nx,1\ny,two\n")
    with pytest.raises(ValueError, match=r"pairs.csv:3: (?s:.*)b"):
        read_rows(path, ("a", "b"), Pair, clean=blank_to_none)
    path = write(tmp_path, "a,b\nx,1,extra\n")
    with pytest.raises(ValueError, match=r"pairs.csv:2: more cells than columns"):
        read_rows(path, ("a", "b"), Pair, clean=blank_to_none)


@pytest.mark.parametrize(
    ("read", "header", "row"),
    [
        (read_corrections, "venue_id,action,notes", "overture:abc,drop,why,extra"),
        (read_prices, "venue_id,item,brand,cents,seen", "osm:node/1,cana,,150,2026-11-23,x"),
        (
            read_review,
            "venue_id,status,name,kind,venue_lat,venue_lon,terrace_lat,terrace_lon,reviewed",
            "osm:node/1,terrace,,,,,,,2026-11-23,x",
        ),
    ],
)
def test_readers_that_crashed_on_extra_cells_now_say_so(
    tmp_path: Path, read: Callable[[Path], object], header: str, row: str
) -> None:
    # These used to fail with an AttributeError (the extra cells arrive as a list).
    path = write(tmp_path, f"{header}\n{row}\n")
    with pytest.raises(ValueError, match=r":2: more cells than columns"):
        read(path)


def test_every_committed_data_file_reads() -> None:
    # The stricter shared reader must accept every committed file as the old readers did.
    assert CORRECTIONS_CSV.exists() and CURATED_CSV.exists() and REVIEW_CSV.exists()
    read_corrections(CORRECTIONS_CSV)
    read_curated(CURATED_CSV)
    read_review(REVIEW_CSV)
    read_prices(PRICES_CSV)
    read_proposals(PROPOSALS_CSV)
    read_candidates(CANDIDATES_CSV)

"""Reading the hand-edited CSV files in `pipeline/data/` into pydantic models.

Every data file has a required header and one record per row. `read_rows` checks the header,
rejects rows with more cells than columns and validates each row, naming the file and line in
every error. What the cells mean (blank cells, renamed columns, extra fields) and what happens
when the file is missing stay with each reader, which passes its own `clean`.
"""

import csv
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

from pydantic import BaseModel, ValidationError

type Row = Mapping[str, str | None]
"""A row as `csv.DictReader` reads it: a cell per column, None for cells a short row lacks."""


def blank_to_none(row: Row) -> dict[str, str | None]:
    """Cells stripped of surrounding spaces, with blank or missing cells as None."""
    return {key: (value or "").strip() or None for key, value in row.items()}


def read_rows[M: BaseModel](
    path: Path,
    columns: Sequence[str],
    model: type[M],
    *,
    clean: Callable[[Row], Mapping[str, object]],
    legacy: Sequence[Sequence[str]] = (),
) -> list[M]:
    """Each row of `path` as a `model`, after `clean`. The header must be `columns` exactly,
    or one of the `legacy` headers; errors always name `columns`, the header to write."""
    accepted = {tuple(columns), *(tuple(old) for old in legacy)}
    with path.open(encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        if tuple(reader.fieldnames or ()) not in accepted:
            raise ValueError(f"{path}: header must be {','.join(columns)}")
        rows: list[M] = []
        for row in reader:
            if None in row:
                raise ValueError(f"{path}:{reader.line_num}: more cells than columns")
            try:
                rows.append(model.model_validate(clean(row)))
            except ValidationError as error:
                raise ValueError(f"{path}:{reader.line_num}: {error}") from error
    return rows

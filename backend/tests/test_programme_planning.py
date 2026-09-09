from datetime import date

import pytest

from app.programme_planning import academic_year_bounds, academic_year_for


def test_academic_year_runs_from_september_to_august() -> None:
    assert academic_year_for(date(2026, 9, 1)) == "2026/27"
    assert academic_year_for(date(2027, 8, 31)) == "2026/27"
    assert academic_year_bounds("2026/27") == (
        date(2026, 9, 1),
        date(2027, 8, 1),
    )


@pytest.mark.parametrize("value", ["2026-27", "26/27", "2026/28", "invalid"])
def test_invalid_academic_year_is_rejected(value: str) -> None:
    with pytest.raises(ValueError):
        academic_year_bounds(value)

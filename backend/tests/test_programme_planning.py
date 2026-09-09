from datetime import date

import pytest

from app.programme_planning import (
    academic_year_bounds,
    academic_year_for,
    planned_cohort_from_row,
)


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


def test_database_row_is_converted_to_planned_cohort_with_named_fields() -> None:
    cohort = planned_cohort_from_row(
        ("pharmacy-general", date(2026, 10, 1), "2026/27", 20, None)
    )

    assert cohort.programme_code == "pharmacy-general"
    assert cohort.start_month == date(2026, 10, 1)
    assert cohort.planned_starts == 20

from datetime import date
from contextlib import nullcontext

import pytest

from app.programme_planning import (
    academic_year_bounds,
    academic_year_for,
    fetch_confirmed_planned_tutors,
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


def test_only_fully_allocated_confirmed_future_tutors_enter_forecast() -> None:
    class FakeConnection:
        def __init__(self) -> None:
            self.statements: list[str] = []

        def transaction(self):
            return nullcontext()

        def cursor(self):
            return nullcontext(self)

        def execute(self, sql: str, _params=None) -> None:
            self.statements.append(sql)

        def fetchall(self):
            return [
                (1, "Future Tutor", None, date(2026, 11, 1), None, 50,
                 "pharmacy-l2", "Pharmacy L2", "Pharmacy", 20),
                (1, "Future Tutor", None, date(2026, 11, 1), None, 50,
                 "pharmacy-l3", "Pharmacy L3", "Pharmacy", 30),
                (2, "Incomplete Tutor", None, date(2026, 11, 1), None, 50,
                 "pharmacy-l2", "Pharmacy L2", "Pharmacy", 20),
            ]

    connection = FakeConnection()
    tutors = fetch_confirmed_planned_tutors(
        connection, date(2026, 10, 12), date(2028, 3, 31)
    )
    assert len(tutors) == 1
    assert tutors[0].is_planned is True
    assert tutors[0].available_from == date(2026, 11, 1)
    assert sum(row.capacity for row in tutors[0].programme_allocations) == 50
    assert "SET TRANSACTION READ ONLY" in connection.statements
    assert "pt.status = 'confirmed'" in " ".join(connection.statements)

from __future__ import annotations

import logging
from datetime import date
from typing import Any

from .models import (
    PlannedCohortRecord,
    ProgrammePlanningRecord,
    Tutor,
    TutorCapacityAllocation,
    Workstream,
)

logger = logging.getLogger(__name__)


def fetch_programme_aliases(connection: Any) -> dict[str, str]:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '10s'")
            cursor.execute(
                """
                SELECT lower(trim(alias_key)), programme_code
                FROM capacity.programme_alias
                ORDER BY alias_key
                """
            )
            return {alias_key: programme_code for alias_key, programme_code in cursor.fetchall()}


def planned_cohort_from_row(row: tuple[Any, ...]) -> PlannedCohortRecord:
    return PlannedCohortRecord(
        programme_code=row[0],
        start_month=row[1],
        academic_year=row[2],
        planned_starts=row[3],
        notes=row[4],
    )


def academic_year_for(value: date) -> str:
    start_year = value.year if value.month >= 9 else value.year - 1
    return f"{start_year}/{str(start_year + 1)[-2:]}"


def academic_year_bounds(academic_year: str) -> tuple[date, date]:
    try:
        start_text, end_text = academic_year.split("/", 1)
        start_year = int(start_text)
        expected_end = str(start_year + 1)[-2:]
    except (TypeError, ValueError):
        raise ValueError("Academic year must use YYYY/YY format") from None
    if len(start_text) != 4 or len(end_text) != 2 or end_text != expected_end:
        raise ValueError("Academic year must use consecutive YYYY/YY format")
    return date(start_year, 9, 1), date(start_year + 1, 8, 1)


def fetch_programme_planning(
    connection: Any, academic_year: str
) -> tuple[list[ProgrammePlanningRecord], list[PlannedCohortRecord]]:
    start_month, end_month = academic_year_bounds(academic_year)
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT p.programme_code, p.display_name, w.display_name, p.level,
                       p.default_duration_months, p.active
                FROM capacity.programme p
                JOIN capacity.workstream w USING (workstream_code)
                ORDER BY w.display_name, p.display_name
                """
            )
            programmes = [
                ProgrammePlanningRecord(
                    programme_code=row[0],
                    display_name=row[1],
                    workstream=Workstream(row[2]),
                    level=row[3],
                    duration_months=row[4],
                    active=row[5],
                )
                for row in cursor.fetchall()
            ]
            cursor.execute(
                """
                SELECT programme_code, start_month, academic_year, planned_starts, notes
                FROM capacity.planned_cohort
                WHERE start_month BETWEEN %(start_month)s AND %(end_month)s
                  AND status <> 'cancelled'
                ORDER BY start_month, programme_code
                """,
                {"start_month": start_month, "end_month": end_month},
            )
            cohorts = [planned_cohort_from_row(row) for row in cursor.fetchall()]
    return programmes, cohorts


def fetch_confirmed_planned_tutors(
    connection: Any, as_of_date: date, horizon_end: date
) -> list[Tutor]:
    """Read confirmed future delivery capacity from the Capacity-owned database."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT pt.planned_tutor_id, pt.tutor_name, pt.attendance_tutor_id,
                       pt.start_date, pt.end_date, pt.max_learners,
                       p.programme_code, p.display_name, w.display_name,
                       ptp.allocated_capacity
                FROM capacity.planned_tutor pt
                JOIN capacity.planned_tutor_programme ptp
                  ON ptp.planned_tutor_id = pt.planned_tutor_id
                JOIN capacity.programme p USING (programme_code)
                JOIN capacity.workstream w ON w.workstream_code = p.workstream_code
                WHERE pt.status = 'confirmed'
                  AND pt.start_date <= %(horizon_end)s
                  AND (pt.end_date IS NULL OR pt.end_date >= %(as_of_date)s)
                ORDER BY pt.planned_tutor_id, p.programme_code
                """,
                {"as_of_date": as_of_date, "horizon_end": horizon_end},
            )
            rows = cursor.fetchall()
    grouped: dict[int, dict[str, Any]] = {}
    for row in rows:
        item = grouped.setdefault(
            row[0],
            {
                "tutor_id": row[2] or f"planned-tutor:{row[0]}",
                "tutor_name": row[1],
                "available_from": row[3],
                "available_until": row[4],
                "capacity": row[5],
                "workstream": Workstream(row[8]),
                "is_planned": True,
                "programme_allocations": [],
            },
        )
        item["programme_allocations"].append(
            TutorCapacityAllocation(
                programme_code=row[6],
                programme_name=row[7],
                workstream=Workstream(row[8]),
                capacity=row[9],
            )
        )
    tutors: list[Tutor] = []
    for item in grouped.values():
        allocated = sum(row.capacity for row in item["programme_allocations"])
        if allocated != item["capacity"]:
            logger.warning(
                "Confirmed planned tutor %s has %s allocated places, not %s; excluding from capacity",
                item["tutor_id"], allocated, item["capacity"],
            )
            continue
        tutors.append(Tutor(**item))
    return tutors


def save_programme_setting(
    connection: Any,
    *,
    programme_code: str,
    duration_months: int,
    active: bool,
    updated_by: str,
) -> ProgrammePlanningRecord | None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.programme p
                SET default_duration_months = %(duration_months)s,
                    active = %(active)s,
                    updated_at = now(),
                    updated_by = %(updated_by)s
                FROM capacity.workstream w
                WHERE p.programme_code = %(programme_code)s
                  AND w.workstream_code = p.workstream_code
                RETURNING p.programme_code, p.display_name, w.display_name, p.level,
                          p.default_duration_months, p.active
                """,
                {
                    "programme_code": programme_code,
                    "duration_months": duration_months,
                    "active": active,
                    "updated_by": updated_by,
                },
            )
            row = cursor.fetchone()
    return (
        ProgrammePlanningRecord(
            programme_code=row[0], display_name=row[1], workstream=Workstream(row[2]),
            level=row[3], duration_months=row[4], active=row[5]
        )
        if row else None
    )


def save_planned_cohort(
    connection: Any,
    *,
    programme_code: str,
    start_month: date,
    planned_starts: int,
    notes: str | None,
    updated_by: str,
) -> PlannedCohortRecord | None:
    month = start_month.replace(day=1)
    academic_year = academic_year_for(month)
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                INSERT INTO capacity.planned_cohort (
                    academic_year, programme_code, start_month, planned_starts,
                    status, notes, updated_at, updated_by
                )
                SELECT %(academic_year)s, p.programme_code, %(start_month)s,
                       %(planned_starts)s, 'planned', %(notes)s, now(), %(updated_by)s
                FROM capacity.programme p
                WHERE p.programme_code = %(programme_code)s
                ON CONFLICT (programme_code, start_month)
                DO UPDATE SET
                    academic_year = EXCLUDED.academic_year,
                    planned_starts = EXCLUDED.planned_starts,
                    status = 'planned',
                    notes = EXCLUDED.notes,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                RETURNING programme_code, start_month, academic_year, planned_starts, notes
                """,
                {
                    "academic_year": academic_year,
                    "programme_code": programme_code,
                    "start_month": month,
                    "planned_starts": planned_starts,
                    "notes": notes,
                    "updated_by": updated_by,
                },
            )
            row = cursor.fetchone()
    return planned_cohort_from_row(row) if row else None

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Any


# Deliberately selects only the fields needed for capacity calculation.
# No learner names, email addresses, phone numbers, or learning-plan URLs leave
# the Attendance database.
LEARNER_PROGRESS_QUERY = """
SELECT DISTINCT ON (apprentice_id)
    apprentice_id AS learner_id,
    tutor_id,
    tutor_name,
    programme_name,
    start_date,
    expected_end_date,
    status_desc,
    synced_at
FROM public.learner_progress
WHERE apprentice_id IS NOT NULL
ORDER BY apprentice_id, start_date DESC NULLS LAST, synced_at DESC NULLS LAST
"""


@dataclass(frozen=True)
class AttendanceLearnerRecord:
    learner_id: str
    tutor_id: str | None
    tutor_name: str | None
    programme_name: str | None
    start_date: date | None
    expected_end_date: date | None
    status_desc: str | None
    synced_at: datetime | None


ACTIVE_TUTORS_QUERY = """
SELECT
    COALESCE(
        NULLIF(btrim(external_system_id::text), ''),
        'attendance-internal:' || id::text
    ) AS tutor_id,
    trim(concat_ws(' ', first_name, last_name)) AS tutor_name
FROM public.tutors
WHERE active IS TRUE
ORDER BY tutor_id
"""


@dataclass(frozen=True)
class AttendanceTutorRecord:
    tutor_id: str
    tutor_name: str


def fetch_learner_progress(connection: Any) -> list[AttendanceLearnerRecord]:
    """Read the minimum capacity dataset in an explicitly read-only transaction."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(LEARNER_PROGRESS_QUERY)
            return [AttendanceLearnerRecord(*row) for row in cursor.fetchall()]


def fetch_active_tutors(connection: Any) -> list[AttendanceTutorRecord]:
    """Read only the active tutor identifier and display name."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(ACTIVE_TUTORS_QUERY)
            return [AttendanceTutorRecord(*row) for row in cursor.fetchall()]

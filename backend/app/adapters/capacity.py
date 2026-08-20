from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from .attendance import AttendanceTutorRecord
from ..models import PipelineLearner, Workstream


TUTOR_SETTINGS_QUERY = """
SELECT DISTINCT ON (attendance_tutor_id)
    attendance_tutor_id,
    tutor_name,
    w.display_name,
    max_learners,
    on_maternity_leave,
    effective_from,
    updated_at,
    updated_by
FROM capacity.tutor_setting ts
JOIN capacity.workstream w USING (workstream_code)
WHERE ts.active IS TRUE
  AND ts.effective_from <= %(as_of_date)s
  AND (ts.effective_to IS NULL OR ts.effective_to >= %(as_of_date)s)
ORDER BY attendance_tutor_id, effective_from DESC, updated_at DESC
"""

TUTOR_STATUS_QUERY = """
SELECT DISTINCT ON (attendance_tutor_id)
    attendance_tutor_id,
    tutor_name,
    is_active,
    effective_from,
    updated_at,
    updated_by
FROM capacity.tutor_status
WHERE effective_from <= %(as_of_date)s
  AND (effective_to IS NULL OR effective_to >= %(as_of_date)s)
ORDER BY attendance_tutor_id, effective_from DESC, updated_at DESC
"""

PROGRAMME_MAPPINGS_QUERY = """
SELECT lower(programme_name), w.display_name
FROM capacity.programme_workstream pw
JOIN capacity.workstream w USING (workstream_code)
WHERE pw.effective_from <= %(as_of_date)s
  AND (pw.effective_to IS NULL OR pw.effective_to >= %(as_of_date)s)
"""

PIPELINE_QUERY = """
SELECT
    source_system || ':' || source_learner_id,
    programme_name,
    w.display_name,
    expected_start_date,
    expected_end_date
FROM capacity.pipeline_learner pl
JOIN capacity.workstream w USING (workstream_code)
WHERE expected_end_date >= %(as_of_date)s
  AND lower(pipeline_status) NOT IN ('cancelled', 'withdrawn', 'lost', 'rejected')
ORDER BY expected_start_date, source_system, source_learner_id
"""


@dataclass(frozen=True)
class TutorSettingRecord:
    tutor_id: str
    tutor_name: str
    workstream: Workstream
    capacity: int
    effective_from: date | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None
    on_maternity_leave: bool = False


@dataclass(frozen=True)
class TutorStatusRecord:
    tutor_id: str
    tutor_name: str
    is_active: bool
    effective_from: date | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None


@dataclass(frozen=True)
class TutorDiscoveryRecord:
    tutor_id: str
    tutor_name: str
    first_seen_at: datetime
    last_seen_at: datetime
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    active_in_attendance: bool

    @property
    def is_new(self) -> bool:
        return self.active_in_attendance and self.acknowledged_at is None


def sync_tutor_discovery(
    connection: Any,
    tutors: list[AttendanceTutorRecord],
) -> list[TutorDiscoveryRecord]:
    """Mirror the canonical active roster into Capacity-owned discovery state."""
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute("SELECT pg_advisory_xact_lock(73420126)")
            cursor.execute(
                """
                SELECT initialized_at
                FROM capacity.tutor_discovery_state
                WHERE state_key = 'active-tutor-baseline'
                """
            )
            baseline_scan = cursor.fetchone() is None
            if baseline_scan and not tutors:
                raise RuntimeError(
                    "Tutor discovery baseline cannot be initialized from an empty roster"
                )
            if baseline_scan:
                cursor.execute(
                    """
                    INSERT INTO capacity.tutor_discovery_state (state_key)
                    VALUES ('active-tutor-baseline')
                    """
                )

            cursor.execute(
                """
                UPDATE capacity.tutor_discovery
                SET active_in_attendance = false,
                    updated_at = now()
                WHERE active_in_attendance IS TRUE
                """
            )
            for tutor in tutors:
                cursor.execute(
                    """
                    INSERT INTO capacity.tutor_discovery (
                        attendance_tutor_id,
                        tutor_name,
                        first_seen_at,
                        last_seen_at,
                        acknowledged_at,
                        acknowledged_by,
                        active_in_attendance,
                        updated_at
                    )
                    VALUES (
                        %(tutor_id)s,
                        %(tutor_name)s,
                        now(),
                        now(),
                        CASE WHEN %(baseline_scan)s THEN now() ELSE NULL END,
                        CASE WHEN %(baseline_scan)s THEN 'system-baseline' ELSE NULL END,
                        true,
                        now()
                    )
                    ON CONFLICT (attendance_tutor_id)
                    DO UPDATE SET
                        tutor_name = EXCLUDED.tutor_name,
                        last_seen_at = now(),
                        active_in_attendance = true,
                        updated_at = now()
                    """,
                    {
                        "tutor_id": tutor.tutor_id,
                        "tutor_name": tutor.tutor_name,
                        "baseline_scan": baseline_scan,
                    },
                )

            cursor.execute(
                """
                SELECT
                    attendance_tutor_id,
                    tutor_name,
                    first_seen_at,
                    last_seen_at,
                    acknowledged_at,
                    acknowledged_by,
                    active_in_attendance
                FROM capacity.tutor_discovery
                WHERE active_in_attendance IS TRUE
                ORDER BY first_seen_at, attendance_tutor_id
                """
            )
            return [TutorDiscoveryRecord(*row) for row in cursor.fetchall()]


def acknowledge_tutor_discovery(
    connection: Any,
    *,
    tutor_id: str,
    acknowledged_by: str,
) -> TutorDiscoveryRecord | None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.tutor_discovery
                SET acknowledged_at = COALESCE(acknowledged_at, now()),
                    acknowledged_by = COALESCE(acknowledged_by, %(acknowledged_by)s),
                    updated_at = now()
                WHERE attendance_tutor_id = %(tutor_id)s
                  AND active_in_attendance IS TRUE
                RETURNING
                    attendance_tutor_id,
                    tutor_name,
                    first_seen_at,
                    last_seen_at,
                    acknowledged_at,
                    acknowledged_by,
                    active_in_attendance
                """,
                {"tutor_id": tutor_id, "acknowledged_by": acknowledged_by},
            )
            row = cursor.fetchone()
            return TutorDiscoveryRecord(*row) if row else None


def fetch_tutor_configuration(
    connection: Any, as_of_date: date
) -> tuple[
    list[TutorSettingRecord],
    dict[str, Workstream],
    list[TutorStatusRecord],
]:
    params = {"as_of_date": as_of_date}
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(TUTOR_SETTINGS_QUERY, params)
            settings = [
                TutorSettingRecord(
                    tutor_id=row[0],
                    tutor_name=row[1],
                    workstream=Workstream(row[2]),
                    capacity=row[3],
                    on_maternity_leave=row[4],
                    effective_from=row[5],
                    updated_at=row[6],
                    updated_by=row[7],
                )
                for row in cursor.fetchall()
            ]
            cursor.execute(PROGRAMME_MAPPINGS_QUERY, params)
            mappings = {
                programme_name: Workstream(workstream)
                for programme_name, workstream in cursor.fetchall()
            }
            cursor.execute(TUTOR_STATUS_QUERY, params)
            statuses = [TutorStatusRecord(*row) for row in cursor.fetchall()]
    return settings, mappings, statuses


def save_tutor_setting(
    connection: Any,
    *,
    tutor_id: str,
    tutor_name: str,
    workstream: Workstream,
    capacity: int,
    on_maternity_leave: bool,
    effective_from: date,
    updated_by: str,
) -> None:
    workstream_code = workstream.value.lower()
    previous_day = effective_from - timedelta(days=1)
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.tutor_setting
                SET effective_to = %(previous_day)s,
                    active = false,
                    updated_at = now(),
                    updated_by = %(updated_by)s
                WHERE attendance_tutor_id = %(tutor_id)s
                  AND effective_from < %(effective_from)s
                  AND active IS TRUE
                  AND (effective_to IS NULL OR effective_to >= %(effective_from)s)
                """,
                {
                    "previous_day": previous_day,
                    "updated_by": updated_by,
                    "tutor_id": tutor_id,
                    "effective_from": effective_from,
                },
            )
            cursor.execute(
                """
                UPDATE capacity.tutor_discovery
                SET acknowledged_at = COALESCE(acknowledged_at, now()),
                    acknowledged_by = COALESCE(acknowledged_by, %(updated_by)s),
                    updated_at = now()
                WHERE attendance_tutor_id = %(tutor_id)s
                  AND active_in_attendance IS TRUE
                """,
                {"tutor_id": tutor_id, "updated_by": updated_by},
            )
            cursor.execute(
                """
                INSERT INTO capacity.tutor_setting (
                    attendance_tutor_id,
                    tutor_name,
                    workstream_code,
                    max_learners,
                    on_maternity_leave,
                    effective_from,
                    effective_to,
                    active,
                    updated_at,
                    updated_by
                )
                VALUES (
                    %(tutor_id)s,
                    %(tutor_name)s,
                    %(workstream_code)s,
                    %(capacity)s,
                    %(on_maternity_leave)s,
                    %(effective_from)s,
                    NULL,
                    true,
                    now(),
                    %(updated_by)s
                )
                ON CONFLICT (attendance_tutor_id, effective_from)
                DO UPDATE SET
                    tutor_name = EXCLUDED.tutor_name,
                    workstream_code = EXCLUDED.workstream_code,
                    max_learners = EXCLUDED.max_learners,
                    on_maternity_leave = EXCLUDED.on_maternity_leave,
                    effective_to = NULL,
                    active = true,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                """,
                {
                    "tutor_id": tutor_id,
                    "tutor_name": tutor_name,
                    "workstream_code": workstream_code,
                    "capacity": capacity,
                    "on_maternity_leave": on_maternity_leave,
                    "effective_from": effective_from,
                    "updated_by": updated_by,
                },
            )


def save_tutor_status(
    connection: Any,
    *,
    tutor_id: str,
    tutor_name: str,
    is_active: bool,
    effective_from: date,
    updated_by: str,
) -> None:
    previous_day = effective_from - timedelta(days=1)
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.tutor_status
                SET effective_to = %(previous_day)s,
                    updated_at = now(),
                    updated_by = %(updated_by)s
                WHERE attendance_tutor_id = %(tutor_id)s
                  AND effective_from < %(effective_from)s
                  AND (effective_to IS NULL OR effective_to >= %(effective_from)s)
                """,
                {
                    "previous_day": previous_day,
                    "updated_by": updated_by,
                    "tutor_id": tutor_id,
                    "effective_from": effective_from,
                },
            )
            cursor.execute(
                """
                UPDATE capacity.tutor_discovery
                SET acknowledged_at = COALESCE(acknowledged_at, now()),
                    acknowledged_by = COALESCE(acknowledged_by, %(updated_by)s),
                    updated_at = now()
                WHERE attendance_tutor_id = %(tutor_id)s
                  AND active_in_attendance IS TRUE
                """,
                {"tutor_id": tutor_id, "updated_by": updated_by},
            )
            cursor.execute(
                """
                INSERT INTO capacity.tutor_status (
                    attendance_tutor_id,
                    tutor_name,
                    is_active,
                    effective_from,
                    effective_to,
                    updated_at,
                    updated_by
                )
                VALUES (
                    %(tutor_id)s,
                    %(tutor_name)s,
                    %(is_active)s,
                    %(effective_from)s,
                    NULL,
                    now(),
                    %(updated_by)s
                )
                ON CONFLICT (attendance_tutor_id, effective_from)
                DO UPDATE SET
                    tutor_name = EXCLUDED.tutor_name,
                    is_active = EXCLUDED.is_active,
                    effective_to = NULL,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                """,
                {
                    "tutor_id": tutor_id,
                    "tutor_name": tutor_name,
                    "is_active": is_active,
                    "effective_from": effective_from,
                    "updated_by": updated_by,
                },
            )


def fetch_capacity_inputs(
    connection: Any, as_of_date: date
) -> tuple[
    list[TutorSettingRecord],
    dict[str, Workstream],
    list[TutorStatusRecord],
    list[PipelineLearner],
]:
    settings, mappings, statuses = fetch_tutor_configuration(connection, as_of_date)
    params = {"as_of_date": as_of_date}
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(PIPELINE_QUERY, params)
            pipeline = [
                PipelineLearner(
                    learner_id=row[0],
                    programme_name=row[1],
                    workstream=Workstream(row[2]),
                    start_date=row[3],
                    expected_end_date=row[4],
                )
                for row in cursor.fetchall()
            ]
    return settings, mappings, statuses, pipeline

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any

from ..models import PipelineLearner, Workstream


TUTOR_SETTINGS_QUERY = """
SELECT DISTINCT ON (attendance_tutor_id)
    attendance_tutor_id,
    tutor_name,
    w.display_name,
    max_learners
FROM capacity.tutor_setting ts
JOIN capacity.workstream w USING (workstream_code)
WHERE ts.active IS TRUE
  AND ts.effective_from <= %(as_of_date)s
  AND (ts.effective_to IS NULL OR ts.effective_to >= %(as_of_date)s)
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


def fetch_capacity_inputs(
    connection: Any, as_of_date: date
) -> tuple[list[TutorSettingRecord], dict[str, Workstream], list[PipelineLearner]]:
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
                )
                for row in cursor.fetchall()
            ]
            cursor.execute(PROGRAMME_MAPPINGS_QUERY, params)
            mappings = {
                programme_name: Workstream(workstream)
                for programme_name, workstream in cursor.fetchall()
            }
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
    return settings, mappings, pipeline

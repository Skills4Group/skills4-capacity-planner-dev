from __future__ import annotations

from datetime import date
from typing import Any

from .forecast import add_months, month_start
from .models import PrivateModelAssumptions, PrivateModelAssumptionsUpdate


def _from_row(row: tuple[Any, ...]) -> PrivateModelAssumptions:
    return PrivateModelAssumptions(
        effective_month=row[0],
        cohort_size=row[1],
        monthly_tutor_cost=float(row[2]) if row[2] is not None else None,
        average_contract_value=float(row[3]) if row[3] is not None else None,
        enrolment_drop_percent=float(row[4]),
        staffed_tutors=row[5],
        updated_at=row[6],
        updated_by=str(row[7]),
    )


def fetch_private_model_assumptions(connection: Any) -> PrivateModelAssumptions:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT effective_month, cohort_size, monthly_tutor_cost,
                       average_contract_value, enrolment_drop_percent,
                       staffed_tutors, updated_at, updated_by
                FROM capacity.private_model_assumption
                WHERE model_id = 1
                """
            )
            row = cursor.fetchone()
    if row:
        return _from_row(row)
    return PrivateModelAssumptions(
        effective_month=add_months(month_start(date.today()), 1),
        cohort_size=50,
        staffed_tutors=None,
        monthly_tutor_cost=None,
        average_contract_value=None,
        enrolment_drop_percent=45,
    )


def save_private_model_assumptions(
    connection: Any, *, values: PrivateModelAssumptionsUpdate, updated_by: str
) -> PrivateModelAssumptions:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                INSERT INTO capacity.private_model_assumption
                    (model_id, effective_month, cohort_size, monthly_tutor_cost,
                     average_contract_value, enrolment_drop_percent,
                     staffed_tutors, updated_by)
                VALUES (1, %(effective_month)s, %(cohort_size)s,
                        %(monthly_tutor_cost)s, %(average_contract_value)s,
                        %(enrolment_drop_percent)s, %(staffed_tutors)s,
                        %(updated_by)s)
                ON CONFLICT (model_id) DO UPDATE SET
                    effective_month = EXCLUDED.effective_month,
                    cohort_size = EXCLUDED.cohort_size,
                    monthly_tutor_cost = EXCLUDED.monthly_tutor_cost,
                    average_contract_value = EXCLUDED.average_contract_value,
                    enrolment_drop_percent = EXCLUDED.enrolment_drop_percent,
                    staffed_tutors = EXCLUDED.staffed_tutors,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                RETURNING effective_month, cohort_size, monthly_tutor_cost,
                          average_contract_value, enrolment_drop_percent,
                          staffed_tutors, updated_at, updated_by
                """,
                {**values.model_dump(), "updated_by": updated_by},
            )
            row = cursor.fetchone()
    return _from_row(row)

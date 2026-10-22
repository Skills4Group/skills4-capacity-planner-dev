from __future__ import annotations

from datetime import date
from typing import Any

from .models import MonthlyMovementRate


DEFAULT_RATE_PERCENT = 4.0


def fetch_movement_rates(
    connection: Any, start_month: date, end_month: date
) -> dict[date, MonthlyMovementRate]:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT month, bil_percent, oof_percent
                FROM capacity.predictive_movement_rate
                WHERE month BETWEEN %(start_month)s AND %(end_month)s
                ORDER BY month
                """,
                {"start_month": start_month, "end_month": end_month},
            )
            rows = cursor.fetchall()
    return {
        row[0]: MonthlyMovementRate(
            month=row[0], bil_percent=float(row[1]), oof_percent=float(row[2])
        )
        for row in rows
    }


def save_movement_rate(
    connection: Any,
    *,
    month: date,
    bil_percent: float,
    oof_percent: float,
    updated_by: str,
) -> MonthlyMovementRate:
    if month.day != 1:
        raise ValueError("month must be the first day of the month")
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                INSERT INTO capacity.predictive_movement_rate
                    (month, bil_percent, oof_percent, updated_at, updated_by)
                VALUES (%(month)s, %(bil_percent)s, %(oof_percent)s, now(), %(updated_by)s)
                ON CONFLICT (month) DO UPDATE SET
                    bil_percent = EXCLUDED.bil_percent,
                    oof_percent = EXCLUDED.oof_percent,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                RETURNING month, bil_percent, oof_percent
                """,
                {
                    "month": month,
                    "bil_percent": bil_percent,
                    "oof_percent": oof_percent,
                    "updated_by": updated_by,
                },
            )
            row = cursor.fetchone()
    return MonthlyMovementRate(
        month=row[0], bil_percent=float(row[1]), oof_percent=float(row[2])
    )

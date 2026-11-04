from __future__ import annotations

from typing import Any

from .models import PrivateModelGrantRecord


def private_model_owner_id(configured_id: str) -> str | None:
    return configured_id.strip().lower() or None


def has_private_model_grant(connection: Any, object_id: str) -> bool:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '10s'")
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1 FROM capacity.private_model_grant
                    WHERE entra_object_id = %(object_id)s::uuid AND active IS TRUE
                )
                """,
                {"object_id": object_id},
            )
            row = cursor.fetchone()
    return bool(row and row[0])


def _grant_from_row(row: tuple[Any, ...]) -> PrivateModelGrantRecord:
    return PrivateModelGrantRecord(
        object_id=str(row[0]),
        display_name=row[1],
        email=row[2],
        granted_at=row[3],
        granted_by=str(row[4]),
    )


def fetch_private_model_grants(connection: Any) -> list[PrivateModelGrantRecord]:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT g.entra_object_id, u.display_name, u.email,
                       g.granted_at, g.granted_by
                FROM capacity.private_model_grant g
                JOIN capacity.app_user u ON u.entra_object_id = g.entra_object_id
                WHERE g.active IS TRUE
                ORDER BY lower(u.display_name), g.entra_object_id
                """
            )
            rows = cursor.fetchall()
    return [_grant_from_row(row) for row in rows]


def save_private_model_grant(
    connection: Any, *, object_id: str, granted_by: str
) -> PrivateModelGrantRecord | None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                WITH saved AS (
                    INSERT INTO capacity.private_model_grant
                        (entra_object_id, active, granted_at, granted_by,
                         updated_at, updated_by)
                    SELECT u.entra_object_id, true, now(), %(granted_by)s::uuid,
                           now(), %(granted_by)s::uuid
                    FROM capacity.app_user u
                    WHERE u.entra_object_id = %(object_id)s::uuid
                    ON CONFLICT (entra_object_id) DO UPDATE SET
                        active = true,
                        granted_at = now(),
                        granted_by = EXCLUDED.granted_by,
                        updated_at = now(),
                        updated_by = EXCLUDED.updated_by
                    RETURNING entra_object_id, granted_at, granted_by
                )
                SELECT saved.entra_object_id, u.display_name, u.email,
                       saved.granted_at, saved.granted_by
                FROM saved JOIN capacity.app_user u
                  ON u.entra_object_id = saved.entra_object_id
                """,
                {"object_id": object_id, "granted_by": granted_by},
            )
            row = cursor.fetchone()
    return _grant_from_row(row) if row else None


def revoke_private_model_grant(
    connection: Any, *, object_id: str, revoked_by: str
) -> bool:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.private_model_grant
                SET active = false,
                    updated_at = now(),
                    updated_by = %(revoked_by)s::uuid
                WHERE entra_object_id = %(object_id)s::uuid
                  AND active IS TRUE
                """,
                {"object_id": object_id, "revoked_by": revoked_by},
            )
            changed = cursor.rowcount == 1
    return changed

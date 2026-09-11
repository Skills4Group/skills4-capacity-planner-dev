from __future__ import annotations

from typing import Any

from .models import AdminUserRecord, AppUserRecord


def app_user_from_row(row: tuple[Any, ...]) -> AppUserRecord:
    return AppUserRecord(
        object_id=str(row[0]),
        display_name=row[1],
        email=row[2],
        first_seen_at=row[3],
        last_seen_at=row[4],
    )


def register_app_user(
    connection: Any,
    *,
    object_id: str,
    display_name: str,
    email: str | None,
) -> AppUserRecord:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                INSERT INTO capacity.app_user (
                    entra_object_id, display_name, email, first_seen_at, last_seen_at
                )
                VALUES (%(object_id)s::uuid, %(display_name)s, %(email)s, now(), now())
                ON CONFLICT (entra_object_id)
                DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    email = COALESCE(EXCLUDED.email, capacity.app_user.email),
                    last_seen_at = now()
                RETURNING entra_object_id, display_name, email,
                          first_seen_at, last_seen_at
                """,
                {
                    "object_id": object_id,
                    "display_name": display_name,
                    "email": email,
                },
            )
            row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Signed-in user could not be registered")
    return app_user_from_row(row)


def fetch_app_users(connection: Any) -> list[AppUserRecord]:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT entra_object_id, display_name, email,
                       first_seen_at, last_seen_at
                FROM capacity.app_user
                ORDER BY lower(display_name), entra_object_id
                """
            )
            rows = cursor.fetchall()
    return [app_user_from_row(row) for row in rows]


def fetch_app_user(connection: Any, object_id: str) -> AppUserRecord | None:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '10s'")
            cursor.execute(
                """
                SELECT entra_object_id, display_name, email,
                       first_seen_at, last_seen_at
                FROM capacity.app_user
                WHERE entra_object_id = %(object_id)s::uuid
                """,
                {"object_id": object_id},
            )
            row = cursor.fetchone()
    return app_user_from_row(row) if row else None


def admin_user_from_row(row: tuple[Any, ...]) -> AdminUserRecord:
    return AdminUserRecord(
        object_id=str(row[0]),
        display_name=row[1],
        email=row[2],
        source="database",
        created_at=row[3],
        created_by=row[4],
        updated_at=row[5],
        updated_by=row[6],
        removable=True,
    )


def is_database_admin(connection: Any, object_id: str) -> bool:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '10s'")
            cursor.execute(
                """
                SELECT EXISTS (
                    SELECT 1
                    FROM capacity.admin_user
                    WHERE entra_object_id = %(object_id)s::uuid
                      AND active IS TRUE
                )
                """,
                {"object_id": object_id},
            )
            row = cursor.fetchone()
    return bool(row and row[0])


def fetch_admin_users(connection: Any) -> list[AdminUserRecord]:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET TRANSACTION READ ONLY")
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                SELECT a.entra_object_id,
                       COALESCE(u.display_name, a.display_name),
                       COALESCE(u.email, a.email),
                       a.created_at, a.created_by, a.updated_at, a.updated_by
                FROM capacity.admin_user a
                LEFT JOIN capacity.app_user u
                  ON u.entra_object_id = a.entra_object_id
                WHERE a.active IS TRUE
                ORDER BY lower(COALESCE(u.display_name, a.display_name)),
                         a.entra_object_id
                """
            )
            rows = cursor.fetchall()
    return [admin_user_from_row(row) for row in rows]


def save_admin_user(
    connection: Any,
    *,
    object_id: str,
    display_name: str,
    email: str | None,
    updated_by: str,
) -> AdminUserRecord:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                INSERT INTO capacity.admin_user (
                    entra_object_id, display_name, email, active,
                    created_at, created_by, updated_at, updated_by
                )
                VALUES (
                    %(object_id)s::uuid, %(display_name)s, %(email)s, true,
                    now(), %(updated_by)s, now(), %(updated_by)s
                )
                ON CONFLICT (entra_object_id)
                DO UPDATE SET
                    display_name = EXCLUDED.display_name,
                    email = EXCLUDED.email,
                    active = true,
                    updated_at = now(),
                    updated_by = EXCLUDED.updated_by
                RETURNING entra_object_id, display_name, email, created_at,
                          created_by, updated_at, updated_by
                """,
                {
                    "object_id": object_id,
                    "display_name": display_name,
                    "email": email,
                    "updated_by": updated_by,
                },
            )
            row = cursor.fetchone()
    if row is None:
        raise RuntimeError("Administrator could not be saved")
    return admin_user_from_row(row)


def remove_admin_user(connection: Any, *, object_id: str, updated_by: str) -> bool:
    with connection.transaction():
        with connection.cursor() as cursor:
            cursor.execute("SET LOCAL statement_timeout = '30s'")
            cursor.execute(
                """
                UPDATE capacity.admin_user
                SET active = false,
                    updated_at = now(),
                    updated_by = %(updated_by)s
                WHERE entra_object_id = %(object_id)s::uuid
                  AND active IS TRUE
                """,
                {"object_id": object_id, "updated_by": updated_by},
            )
            changed = cursor.rowcount == 1
    return changed


def configured_admin_record(
    object_id: str,
    *,
    current_object_id: str | None = None,
    current_display_name: str | None = None,
) -> AdminUserRecord:
    is_current = bool(
        current_object_id and object_id.lower() == current_object_id.lower()
    )
    return AdminUserRecord(
        object_id=object_id,
        display_name=(
            current_display_name
            if is_current and current_display_name
            else "Configured administrator"
        ),
        email=None,
        source="configuration",
        created_at=None,
        created_by=None,
        updated_at=None,
        updated_by=None,
        removable=False,
    )

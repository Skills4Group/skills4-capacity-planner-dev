from __future__ import annotations

from functools import lru_cache
from typing import Any

from azure.identity import DefaultAzureCredential
import psycopg

from .config import Settings


POSTGRES_TOKEN_SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


@lru_cache
def _credential(client_id: str | None) -> DefaultAzureCredential:
    return DefaultAzureCredential(managed_identity_client_id=client_id)


def connect_with_entra(
    *, host: str, database: str, user: str, client_id: str | None
) -> Any:
    token = _credential(client_id).get_token(POSTGRES_TOKEN_SCOPE).token
    return psycopg.connect(
        host=host,
        dbname=database,
        user=user,
        password=token,
        sslmode="require",
        connect_timeout=10,
    )


def capacity_connection(settings: Settings) -> Any:
    if not settings.capacity_database_host or not settings.capacity_database_user:
        raise RuntimeError("Capacity database connection is not configured")
    return connect_with_entra(
        host=settings.capacity_database_host,
        database=settings.capacity_database_name,
        user=settings.capacity_database_user,
        client_id=settings.azure_client_id,
    )


def attendance_connection(settings: Settings) -> Any:
    if not settings.attendance_database_host or not settings.attendance_database_user:
        raise RuntimeError("Attendance database connection is not configured")
    return connect_with_entra(
        host=settings.attendance_database_host,
        database=settings.attendance_database_name,
        user=settings.attendance_database_user,
        client_id=settings.azure_client_id,
    )

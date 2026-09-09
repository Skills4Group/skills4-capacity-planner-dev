from __future__ import annotations

import argparse
from pathlib import Path

from azure.identity import DefaultAzureCredential
import psycopg


SCOPE = "https://ossrdbms-aad.database.windows.net/.default"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply one Capacity Tracker migration using the signed-in Azure CLI user."
    )
    parser.add_argument("migration", type=Path)
    parser.add_argument("--host", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--user", required=True)
    parser.add_argument("--client-id")
    args = parser.parse_args()

    migration = args.migration.resolve()
    expected_root = (Path(__file__).resolve().parents[1] / "migrations").resolve()
    if migration.parent != expected_root or migration.suffix != ".sql":
        raise SystemExit(f"Migration must be a .sql file directly under {expected_root}")

    token = DefaultAzureCredential(
        managed_identity_client_id=args.client_id
    ).get_token(SCOPE).token
    with psycopg.connect(
        host=args.host,
        dbname=args.database,
        user=args.user,
        password=token,
        sslmode="require",
        connect_timeout=15,
    ) as connection:
        connection.execute(migration.read_text(encoding="utf-8"))
    print(f"Applied {migration.name} to {args.database} on {args.host}")


if __name__ == "__main__":
    main()

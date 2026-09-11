from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.admin_users import (
    admin_user_from_row,
    app_user_from_row,
    configured_admin_record,
)
from app.models import AdminUserCreateRequest


OBJECT_ID = "8d2c6f13-31d5-4c7b-9cf4-8a9f81e5a201"


def test_admin_request_normalises_internal_entra_identity() -> None:
    request = AdminUserCreateRequest(object_id=f"  {OBJECT_ID.upper()}  ")

    assert request.object_id == OBJECT_ID


@pytest.mark.parametrize("object_id", ["", "not-a-guid", "1234"])
def test_admin_request_rejects_invalid_entra_object_id(object_id: str) -> None:
    with pytest.raises(ValidationError):
        AdminUserCreateRequest(object_id=object_id)


def test_signed_in_user_row_retains_first_and_last_seen_dates() -> None:
    first_seen = datetime(2026, 9, 11, 9, 30, tzinfo=timezone.utc)
    last_seen = datetime(2026, 9, 11, 10, 15, tzinfo=timezone.utc)
    user = app_user_from_row(
        (
            OBJECT_ID,
            "Alex Taylor",
            "alex.taylor@skills4group.co.uk",
            first_seen,
            last_seen,
        )
    )

    assert user.display_name == "Alex Taylor"
    assert user.first_seen_at == first_seen
    assert user.last_seen_at == last_seen


def test_database_admin_row_retains_audit_details() -> None:
    now = datetime(2026, 9, 11, 9, 30, tzinfo=timezone.utc)
    admin = admin_user_from_row(
        (
            OBJECT_ID,
            "Alex Taylor",
            "alex.taylor@skills4group.co.uk",
            now,
            "Si Ung",
            now,
            "Si Ung",
        )
    )

    assert admin.object_id == OBJECT_ID
    assert admin.source == "database"
    assert admin.removable
    assert admin.updated_by == "Si Ung"


def test_configured_admin_is_protected_from_in_app_removal() -> None:
    admin = configured_admin_record(
        OBJECT_ID,
        current_object_id=OBJECT_ID.upper(),
        current_display_name="Si Ung",
    )

    assert admin.display_name == "Si Ung"
    assert admin.source == "configuration"
    assert not admin.removable

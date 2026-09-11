import base64
import json

from fastapi import HTTPException
from starlette.requests import Request

from app.auth import require_admin, resolve_user
from app.config import Settings


def request_with_headers(headers: dict[str, str]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": [
                (name.lower().encode(), value.encode())
                for name, value in headers.items()
            ],
        }
    )


def test_auth_headers_are_not_trusted_until_platform_auth_is_enabled() -> None:
    settings = Settings(auth_enabled=False, admin_object_ids="admin-id")
    user = resolve_user(
        request_with_headers({"x-ms-client-principal-id": "admin-id"}), settings
    )
    assert not user.authenticated
    try:
        require_admin(
            request_with_headers({"x-ms-client-principal-id": "admin-id"}), settings
        )
    except HTTPException as exc:
        assert exc.status_code == 503
    else:
        raise AssertionError("Administrative writes must be disabled")


def test_only_allowlisted_authenticated_user_is_admin() -> None:
    settings = Settings(auth_enabled=True, admin_object_ids="admin-id, second-id")
    admin = resolve_user(
        request_with_headers(
            {
                "x-ms-client-principal-id": "ADMIN-ID",
                "x-ms-client-principal-name": "Admin User",
            }
        ),
        settings,
    )
    non_admin = resolve_user(
        request_with_headers({"x-ms-client-principal-id": "other-id"}), settings
    )
    assert admin.authenticated and admin.is_admin
    assert admin.display_name == "Admin User"
    assert non_admin.authenticated and not non_admin.is_admin


def test_database_admin_ids_extend_the_configured_allowlist() -> None:
    settings = Settings(auth_enabled=True, admin_object_ids="bootstrap-id")
    request = request_with_headers(
        {
            "x-ms-client-principal-id": "DATABASE-ID",
            "x-ms-client-principal-name": "Database Admin",
        }
    )

    user = resolve_user(request, settings, {"database-id"})
    required = require_admin(request, settings, {"DATABASE-ID"})

    assert user.authenticated and user.is_admin
    assert required.object_id == "DATABASE-ID"


def test_entra_claims_supply_display_name_and_email() -> None:
    principal = base64.b64encode(
        json.dumps(
            {
                "claims": [
                    {"typ": "name", "val": "Alex Taylor"},
                    {
                        "typ": "preferred_username",
                        "val": "Alex.Taylor@Skills4Group.co.uk",
                    },
                ]
            }
        ).encode()
    ).decode()
    settings = Settings(auth_enabled=True)

    user = resolve_user(
        request_with_headers(
            {
                "x-ms-client-principal-id": "USER-ID",
                "x-ms-client-principal-name": "fallback@skills4group.co.uk",
                "x-ms-client-principal": principal,
            }
        ),
        settings,
    )

    assert user.display_name == "Alex Taylor"
    assert user.email == "alex.taylor@skills4group.co.uk"

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

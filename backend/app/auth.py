from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException, Request, status

from .config import Settings


@dataclass(frozen=True)
class AppUser:
    authenticated: bool
    is_admin: bool
    object_id: str | None = None
    display_name: str | None = None


def resolve_user(request: Request, settings: Settings) -> AppUser:
    if not settings.auth_enabled:
        return AppUser(authenticated=False, is_admin=False)
    object_id = request.headers.get("x-ms-client-principal-id")
    display_name = request.headers.get("x-ms-client-principal-name")
    if not object_id:
        return AppUser(authenticated=False, is_admin=False)
    return AppUser(
        authenticated=True,
        is_admin=object_id.lower() in settings.admin_ids,
        object_id=object_id,
        display_name=display_name,
    )


def require_admin(request: Request, settings: Settings) -> AppUser:
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrative writes are not enabled",
        )
    user = resolve_user(request, settings)
    if not user.authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in is required",
        )
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Capacity administrator access is required",
        )
    return user

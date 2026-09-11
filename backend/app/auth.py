from __future__ import annotations

import base64
from collections.abc import Collection
from dataclasses import dataclass
import json

from fastapi import HTTPException, Request, status

from .config import Settings


@dataclass(frozen=True)
class AppUser:
    authenticated: bool
    is_admin: bool
    object_id: str | None = None
    display_name: str | None = None
    email: str | None = None


def _principal_claims(request: Request) -> dict[str, str]:
    encoded = request.headers.get("x-ms-client-principal")
    if not encoded:
        return {}
    try:
        padded = encoded + "=" * (-len(encoded) % 4)
        principal = json.loads(base64.b64decode(padded).decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    claims = principal.get("claims") or principal.get("user_claims") or []
    return {
        str(claim.get("typ", "")).lower(): str(claim.get("val", ""))
        for claim in claims
        if claim.get("typ") and claim.get("val")
    }


def _claim(claims: dict[str, str], *names: str) -> str | None:
    for name in names:
        direct = claims.get(name.lower())
        if direct:
            return direct
        suffix = next(
            (value for key, value in claims.items() if key.endswith(f"/{name.lower()}")),
            None,
        )
        if suffix:
            return suffix
    return None


def resolve_user(
    request: Request,
    settings: Settings,
    additional_admin_ids: Collection[str] = (),
) -> AppUser:
    if not settings.auth_enabled:
        return AppUser(authenticated=False, is_admin=False)
    object_id = request.headers.get("x-ms-client-principal-id")
    principal_name = request.headers.get("x-ms-client-principal-name")
    if not object_id:
        return AppUser(authenticated=False, is_admin=False)
    claims = _principal_claims(request)
    email = _claim(
        claims,
        "preferred_username",
        "emailaddress",
        "email",
        "upn",
    )
    if not email and principal_name and "@" in principal_name:
        email = principal_name
    display_name = _claim(claims, "name") or principal_name or email
    return AppUser(
        authenticated=True,
        is_admin=(
            object_id.lower() in settings.admin_ids
            or object_id.lower() in {value.lower() for value in additional_admin_ids}
        ),
        object_id=object_id,
        display_name=display_name,
        email=email.lower() if email else None,
    )


def require_admin(
    request: Request,
    settings: Settings,
    additional_admin_ids: Collection[str] = (),
) -> AppUser:
    return require_admin_user(
        resolve_user(request, settings, additional_admin_ids), settings
    )


def require_admin_user(user: AppUser, settings: Settings) -> AppUser:
    if not settings.auth_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Administrative writes are not enabled",
        )
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

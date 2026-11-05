from contextlib import nullcontext
from datetime import datetime, timezone
import importlib

from fastapi.testclient import TestClient

from app.config import Settings
from app.demo import build_demo_forecast, build_demo_predictive_forecast
from app.models import PrivateModelAssumptions, PrivateModelGrantRecord


main = importlib.import_module("app.main")
client = TestClient(main.app)
OWNER = "f5340662-aaa0-42ce-81d7-c8478e5e4889"
OTHER = "11111111-1111-4111-8111-111111111111"


def _headers(object_id: str) -> dict[str, str]:
    return {"x-ms-client-principal-id": object_id}


def _configure(monkeypatch, *, owner_id: str = OWNER) -> None:
    monkeypatch.setattr(
        main,
        "settings",
        Settings(
            auth_enabled=True,
            database_mode="live",
            private_model_owner_object_id=owner_id,
            admin_object_ids=OTHER,
        ),
    )
    monkeypatch.setattr(main, "capacity_connection", lambda _: nullcontext(object()))


def test_private_model_fails_closed_without_owner_configuration(monkeypatch) -> None:
    _configure(monkeypatch, owner_id="")
    access = client.get("/api/v1/private-model/access", headers=_headers(OWNER))
    assert access.json() == {"can_view": False, "is_owner": False}
    assert client.get("/api/v1/private-model/forecast", headers=_headers(OWNER)).status_code == 503


def test_capacity_admin_cannot_manage_or_view_private_model(monkeypatch) -> None:
    _configure(monkeypatch)
    monkeypatch.setattr(main, "has_private_model_grant", lambda *_: False)
    access = client.get("/api/v1/private-model/access", headers=_headers(OTHER))
    assert access.json() == {"can_view": False, "is_owner": False}
    assert client.get("/api/v1/private-model/users", headers=_headers(OTHER)).status_code == 403
    assert client.put(f"/api/v1/private-model/users/{OWNER}", headers=_headers(OTHER)).status_code == 403
    assert client.delete(f"/api/v1/private-model/users/{OWNER}", headers=_headers(OTHER)).status_code == 403
    assert client.get("/api/v1/private-model/forecast", headers=_headers(OTHER)).status_code == 403
    assert client.get("/api/v1/private-model/predictive-forecast", headers=_headers(OTHER)).status_code == 403
    assert client.get("/api/v1/private-model/assumptions", headers=_headers(OTHER)).status_code == 403


def test_only_owner_can_grant_registered_users(monkeypatch) -> None:
    _configure(monkeypatch)
    monkeypatch.setattr(main, "fetch_app_users", lambda _: [])
    monkeypatch.setattr(main, "fetch_private_model_grants", lambda _: [])
    saved = PrivateModelGrantRecord(
        object_id=OTHER,
        display_name="Invited user",
        email=None,
        granted_at=datetime.now(timezone.utc),
        granted_by=OWNER,
    )
    captured = []

    def save(_, *, object_id: str, granted_by: str):
        captured.append((object_id, granted_by))
        return saved

    monkeypatch.setattr(main, "save_private_model_grant", save)
    assert client.get("/api/v1/private-model/access", headers=_headers(OWNER)).json() == {
        "can_view": True, "is_owner": True,
    }
    directory = client.get("/api/v1/private-model/users", headers=_headers(OWNER))
    assert directory.status_code == 200
    assert directory.json()["owner_object_id"] == OWNER
    response = client.put(f"/api/v1/private-model/users/{OTHER}", headers=_headers(OWNER))
    assert response.status_code == 200
    assert captured == [(OTHER, OWNER)]
    assert client.put(f"/api/v1/private-model/users/{OWNER}", headers=_headers(OWNER)).status_code == 409


def test_invited_user_can_read_only_while_grant_is_active(monkeypatch) -> None:
    _configure(monkeypatch)
    granted = True
    monkeypatch.setattr(main, "has_private_model_grant", lambda *_: granted)
    monkeypatch.setattr(main, "live_forecast", build_demo_forecast)
    monkeypatch.setattr(main, "live_predictive_forecast", build_demo_predictive_forecast)
    assert client.get("/api/v1/private-model/access", headers=_headers(OTHER)).json() == {
        "can_view": True, "is_owner": False,
    }
    assert client.get("/api/v1/private-model/forecast", headers=_headers(OTHER)).status_code == 200
    assert client.get("/api/v1/private-model/predictive-forecast", headers=_headers(OTHER)).status_code == 200
    assert client.get("/api/v1/private-model/users", headers=_headers(OTHER)).status_code == 403
    granted = False
    assert client.get("/api/v1/private-model/forecast", headers=_headers(OTHER)).status_code == 403
    assert client.get("/api/v1/private-model/predictive-forecast", headers=_headers(OTHER)).status_code == 403


def test_private_model_requires_sign_in(monkeypatch) -> None:
    _configure(monkeypatch)
    assert client.get("/api/v1/private-model/forecast").status_code == 401
    assert client.get("/api/v1/private-model/users").status_code == 401


def test_only_owner_can_revoke_access(monkeypatch) -> None:
    _configure(monkeypatch)
    revoked = []

    def revoke(_, *, object_id: str, revoked_by: str) -> bool:
        revoked.append((object_id, revoked_by))
        return True

    monkeypatch.setattr(main, "revoke_private_model_grant", revoke)
    response = client.delete(f"/api/v1/private-model/users/{OTHER}", headers=_headers(OWNER))
    assert response.status_code == 200
    assert revoked == [(OTHER, OWNER)]
    assert client.delete(f"/api/v1/private-model/users/{OWNER}", headers=_headers(OWNER)).status_code == 409


def test_private_model_fails_closed_when_grant_lookup_fails(monkeypatch) -> None:
    _configure(monkeypatch)

    def broken_lookup(*_) -> bool:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(main, "has_private_model_grant", broken_lookup)
    assert client.get("/api/v1/private-model/access", headers=_headers(OTHER)).status_code == 503
    assert client.get("/api/v1/private-model/forecast", headers=_headers(OTHER)).status_code == 503


def test_private_model_financial_assumptions_are_owner_written(monkeypatch) -> None:
    _configure(monkeypatch)
    monkeypatch.setattr(main, "has_private_model_grant", lambda *_: True)
    assumption = PrivateModelAssumptions(
        effective_month="2026-12-01", cohort_size=50,
        monthly_tutor_cost=None, average_contract_value=None,
        enrolment_drop_percent=45,
    )
    monkeypatch.setattr(main, "fetch_private_model_assumptions", lambda _: assumption)
    captured = []

    def save(_, *, values, updated_by):
        captured.append((values, updated_by))
        return assumption

    monkeypatch.setattr(main, "save_private_model_assumptions", save)
    assert client.get("/api/v1/private-model/assumptions", headers=_headers(OTHER)).status_code == 200
    assert client.get("/api/v1/private-model/assumptions").status_code == 401
    body = {
        "effective_month": "2026-12-01", "cohort_size": 50,
        "monthly_tutor_cost": 3000, "average_contract_value": 9000,
        "enrolment_drop_percent": 45,
    }
    assert client.put("/api/v1/private-model/assumptions", headers=_headers(OTHER), json=body).status_code == 403
    assert client.put("/api/v1/private-model/assumptions", headers=_headers(OWNER), json=body).status_code == 200
    assert captured[0][1] == OWNER
    assert captured[0][0].average_contract_value == 9000


def test_private_model_rejects_invalid_financial_inputs(monkeypatch) -> None:
    _configure(monkeypatch)
    body = {
        "effective_month": "2026-12-15", "cohort_size": 0,
        "monthly_tutor_cost": -1, "average_contract_value": 9000,
        "enrolment_drop_percent": 120,
    }
    assert client.put("/api/v1/private-model/assumptions", headers=_headers(OWNER), json=body).status_code == 422

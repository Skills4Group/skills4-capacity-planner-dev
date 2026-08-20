from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_health_endpoint() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_demo_forecast_contract() -> None:
    response = client.get("/api/v1/forecast/demo")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["months"]) == 18
    assert {row["workstream"] for row in payload["workstream_months"]} == {
        "Dental",
        "Pharmacy",
        "Housing",
        "Science",
        "Business",
    }
    assert all(row["workstream"] != "Operations" for row in payload["tutor_months"])


def test_demo_predictive_forecast_contract() -> None:
    response = client.get("/api/v1/predictive-forecast/demo")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["months"]) == 18
    assert len(payload["workstream_months"]) == 90
    assert all(
        row["workstream"] != "Operations" for row in payload["workstream_months"]
    )
    assert all(
        row["predicted_active_p90"] >= row["predicted_active_p50"]
        for row in payload["workstream_months"]
    )


def test_tutor_write_is_disabled_without_platform_authentication() -> None:
    response = client.put(
        "/api/v1/tutors/T1/capacity",
        headers={"x-ms-client-principal-id": "forged-admin"},
        json={"capacity": 40, "workstream": "Dental"},
    )
    assert response.status_code == 503


def test_zero_capacity_and_maternity_flag_pass_request_validation() -> None:
    response = client.put(
        "/api/v1/tutors/T1/capacity",
        headers={"x-ms-client-principal-id": "forged-admin"},
        json={
            "capacity": 0,
            "workstream": "Business",
            "on_maternity_leave": True,
        },
    )
    assert response.status_code == 503


def test_tutor_acknowledgement_is_disabled_without_platform_authentication() -> None:
    response = client.put(
        "/api/v1/tutors/T1/acknowledge",
        headers={"x-ms-client-principal-id": "forged-admin"},
    )
    assert response.status_code == 503


def test_tutor_discovery_refresh_requires_live_database_mode() -> None:
    response = client.post("/api/v1/tutors/discovery/refresh")
    assert response.status_code == 503

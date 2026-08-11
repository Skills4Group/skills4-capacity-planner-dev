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
    }


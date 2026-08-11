from pathlib import Path

import logging
from datetime import date

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .demo import build_demo_forecast
from .forecast import build_forecast
from .adapters.attendance import fetch_active_tutors, fetch_learner_progress
from .adapters.capacity import (
    fetch_capacity_inputs,
    fetch_tutor_configuration,
    save_tutor_setting,
)
from .auth import require_admin, resolve_user
from .database import attendance_connection, capacity_connection
from .live_forecast import build_live_request
from .models import (
    ForecastRequest,
    ForecastResponse,
    SessionResponse,
    TutorListResponse,
    TutorUpdateRequest,
    TutorUpdateResponse,
)
from .tutor_admin import build_tutor_admin_records

settings = get_settings()
logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="Monthly tutor-capacity forecasting for Skills 4.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "environment": settings.environment}


@app.get("/api/v1/session", response_model=SessionResponse)
def session(request: Request) -> SessionResponse:
    user = resolve_user(request, settings)
    return SessionResponse(
        authenticated=user.authenticated,
        is_admin=user.is_admin,
        display_name=user.display_name,
    )


@app.get("/api/v1/forecast/demo", response_model=ForecastResponse)
def demo_forecast() -> ForecastResponse:
    return build_demo_forecast()


@app.get("/api/v1/forecast", response_model=ForecastResponse)
def live_forecast() -> ForecastResponse:
    if settings.database_mode.lower() != "live":
        raise HTTPException(status_code=503, detail="Live data mode is not configured")
    try:
        with attendance_connection(settings) as attendance:
            learners = fetch_learner_progress(attendance)
            tutors = fetch_active_tutors(attendance)
        with capacity_connection(settings) as capacity:
            tutor_settings, mappings, pipeline = fetch_capacity_inputs(
                capacity, date.today()
            )
        request = build_live_request(
            as_of_date=date.today(),
            months=settings.forecast_months,
            attendance_learners=learners,
            attendance_tutors=tutors,
            tutor_settings=tutor_settings,
            programme_mappings=mappings,
            pipeline_learners=pipeline,
        )
        return build_forecast(request)
    except Exception:
        logger.exception("Live forecast generation failed")
        raise HTTPException(
            status_code=503, detail="Live forecast data is temporarily unavailable"
        ) from None


@app.get("/api/v1/tutors", response_model=TutorListResponse)
def list_tutors() -> TutorListResponse:
    if settings.database_mode.lower() != "live":
        raise HTTPException(status_code=503, detail="Live data mode is not configured")
    as_of_date = date.today()
    try:
        with attendance_connection(settings) as attendance:
            learners = fetch_learner_progress(attendance)
            tutors = fetch_active_tutors(attendance)
        with capacity_connection(settings) as capacity:
            tutor_settings, mappings = fetch_tutor_configuration(
                capacity, as_of_date
            )
        return TutorListResponse(
            as_of_date=as_of_date,
            tutors=build_tutor_admin_records(
                as_of_date=as_of_date,
                attendance_learners=learners,
                attendance_tutors=tutors,
                tutor_settings=tutor_settings,
                programme_mappings=mappings,
            ),
        )
    except Exception:
        logger.exception("Tutor directory loading failed")
        raise HTTPException(
            status_code=503, detail="Tutor data is temporarily unavailable"
        ) from None


@app.put(
    "/api/v1/tutors/{tutor_id}/capacity", response_model=TutorUpdateResponse
)
def update_tutor_capacity(
    tutor_id: str, update: TutorUpdateRequest, request: Request
) -> TutorUpdateResponse:
    user = require_admin(request, settings)
    as_of_date = date.today()
    try:
        with attendance_connection(settings) as attendance:
            tutors = fetch_active_tutors(attendance)
        tutor = next((item for item in tutors if item.tutor_id == tutor_id), None)
        if tutor is None:
            raise HTTPException(status_code=404, detail="Active tutor not found")
        actor = user.display_name or user.object_id or "unknown-admin"
        with capacity_connection(settings) as capacity:
            save_tutor_setting(
                capacity,
                tutor_id=tutor.tutor_id,
                tutor_name=tutor.tutor_name,
                workstream=update.workstream,
                capacity=update.capacity,
                effective_from=as_of_date,
                updated_by=actor,
            )
        return TutorUpdateResponse(
            tutor_id=tutor.tutor_id,
            capacity=update.capacity,
            workstream=update.workstream,
            updated_by=actor,
            effective_from=as_of_date,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Tutor setting update failed")
        raise HTTPException(
            status_code=503, detail="Tutor setting could not be saved"
        ) from None


@app.post("/api/v1/forecast", response_model=ForecastResponse)
def calculate_forecast(request: ForecastRequest) -> ForecastResponse:
    return build_forecast(request)


static_directory = Path(__file__).resolve().parent.parent / "static"
if static_directory.exists():
    app.mount("/", StaticFiles(directory=static_directory, html=True), name="frontend")

from pathlib import Path

import logging
from datetime import date, datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .demo import build_demo_forecast, build_demo_predictive_forecast
from .forecast import build_forecast
from .adapters.attendance import fetch_active_tutors, fetch_learner_progress
from .adapters.capacity import (
    acknowledge_tutor_discovery,
    fetch_capacity_inputs,
    fetch_tutor_configuration,
    save_tutor_setting,
    sync_tutor_discovery,
)
from .auth import require_admin, resolve_user
from .database import attendance_connection, capacity_connection
from .live_forecast import build_live_request
from .models import (
    ForecastRequest,
    ForecastResponse,
    PredictiveForecastResponse,
    SessionResponse,
    TutorAcknowledgementResponse,
    TutorDiscoveryItem,
    TutorDiscoverySummary,
    TutorListResponse,
    TutorUpdateRequest,
    TutorUpdateResponse,
)
from .predictive_forecast import build_predictive_forecast
from .tutor_admin import build_tutor_admin_records
from .tutor_identity import build_tutor_identity_map

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


@app.get(
    "/api/v1/predictive-forecast/demo", response_model=PredictiveForecastResponse
)
def demo_predictive_forecast() -> PredictiveForecastResponse:
    return build_demo_predictive_forecast()


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


@app.get("/api/v1/predictive-forecast", response_model=PredictiveForecastResponse)
def live_predictive_forecast() -> PredictiveForecastResponse:
    if settings.database_mode.lower() != "live":
        raise HTTPException(status_code=503, detail="Live data mode is not configured")
    as_of_date = date.today()
    try:
        with attendance_connection(settings) as attendance:
            learners = fetch_learner_progress(attendance)
            tutors = fetch_active_tutors(attendance)
        with capacity_connection(settings) as capacity:
            tutor_settings, mappings, pipeline = fetch_capacity_inputs(
                capacity, as_of_date
            )
        request = build_live_request(
            as_of_date=as_of_date,
            months=settings.forecast_months,
            attendance_learners=learners,
            attendance_tutors=tutors,
            tutor_settings=tutor_settings,
            programme_mappings=mappings,
            pipeline_learners=pipeline,
        )
        return build_predictive_forecast(
            as_of_date=as_of_date,
            months=settings.forecast_months,
            attendance_learners=learners,
            forecast_request=request,
            programme_mappings=mappings,
        )
    except Exception:
        logger.exception("Predictive forecast generation failed")
        raise HTTPException(
            status_code=503,
            detail="Predictive forecast data is temporarily unavailable",
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
            discoveries = sync_tutor_discovery(
                capacity, build_tutor_identity_map(tutors).tutors
            )
        return TutorListResponse(
            as_of_date=as_of_date,
            tutors=build_tutor_admin_records(
                as_of_date=as_of_date,
                attendance_learners=learners,
                attendance_tutors=tutors,
                tutor_settings=tutor_settings,
                programme_mappings=mappings,
                tutor_discoveries=discoveries,
            ),
            new_tutor_count=sum(discovery.is_new for discovery in discoveries),
        )
    except Exception:
        logger.exception("Tutor directory loading failed")
        raise HTTPException(
            status_code=503, detail="Tutor data is temporarily unavailable"
        ) from None


@app.post(
    "/api/v1/tutors/discovery/refresh",
    response_model=TutorDiscoverySummary,
)
def refresh_tutor_discovery() -> TutorDiscoverySummary:
    if settings.database_mode.lower() != "live":
        raise HTTPException(status_code=503, detail="Live data mode is not configured")
    try:
        with attendance_connection(settings) as attendance:
            tutors = fetch_active_tutors(attendance)
        canonical_tutors = build_tutor_identity_map(tutors).tutors
        with capacity_connection(settings) as capacity:
            discoveries = sync_tutor_discovery(capacity, canonical_tutors)
        new_tutors = [discovery for discovery in discoveries if discovery.is_new]
        return TutorDiscoverySummary(
            checked_at=datetime.now(timezone.utc),
            new_tutor_count=len(new_tutors),
            new_tutors=[
                TutorDiscoveryItem(
                    tutor_id=discovery.tutor_id,
                    tutor_name=discovery.tutor_name,
                    first_seen_at=discovery.first_seen_at,
                )
                for discovery in new_tutors
            ],
        )
    except Exception:
        logger.exception("Tutor discovery refresh failed")
        raise HTTPException(
            status_code=503, detail="Tutor discovery is temporarily unavailable"
        ) from None


@app.put(
    "/api/v1/tutors/{tutor_id}/acknowledge",
    response_model=TutorAcknowledgementResponse,
)
def acknowledge_new_tutor(
    tutor_id: str, request: Request
) -> TutorAcknowledgementResponse:
    user = require_admin(request, settings)
    actor = user.display_name or user.object_id or "unknown-admin"
    try:
        with capacity_connection(settings) as capacity:
            discovery = acknowledge_tutor_discovery(
                capacity,
                tutor_id=tutor_id,
                acknowledged_by=actor,
            )
        if discovery is None or discovery.acknowledged_at is None:
            raise HTTPException(status_code=404, detail="New active tutor not found")
        return TutorAcknowledgementResponse(
            tutor_id=discovery.tutor_id,
            acknowledged_at=discovery.acknowledged_at,
            acknowledged_by=discovery.acknowledged_by or actor,
        )
    except HTTPException:
        raise
    except Exception:
        logger.exception("Tutor acknowledgement failed")
        raise HTTPException(
            status_code=503, detail="Tutor acknowledgement could not be saved"
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
                on_maternity_leave=update.on_maternity_leave,
                effective_from=as_of_date,
                updated_by=actor,
            )
        return TutorUpdateResponse(
            tutor_id=tutor.tutor_id,
            capacity=update.capacity,
            workstream=update.workstream,
            on_maternity_leave=update.on_maternity_leave,
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

from pathlib import Path

import logging
from datetime import date

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import get_settings
from .demo import build_demo_forecast
from .forecast import build_forecast
from .adapters.attendance import fetch_active_tutors, fetch_learner_progress
from .adapters.capacity import fetch_capacity_inputs
from .database import attendance_connection, capacity_connection
from .live_forecast import build_live_request
from .models import ForecastRequest, ForecastResponse

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
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "healthy", "environment": settings.environment}


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


@app.post("/api/v1/forecast", response_model=ForecastResponse)
def calculate_forecast(request: ForecastRequest) -> ForecastResponse:
    return build_forecast(request)


static_directory = Path(__file__).resolve().parent.parent / "static"
if static_directory.exists():
    app.mount("/", StaticFiles(directory=static_directory, html=True), name="frontend")

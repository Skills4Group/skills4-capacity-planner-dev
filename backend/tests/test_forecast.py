from datetime import date

from app.forecast import build_forecast
from app.models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    PipelineLearner,
    Tutor,
    Workstream,
)


def test_break_learners_do_not_use_capacity() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 11),
        months=1,
        tutors=[Tutor(tutor_id="T1", tutor_name="Tutor One", workstream=Workstream.DENTAL)],
        existing_learners=[
            ExistingLearner(
                learner_id="L1",
                tutor_id="T1",
                programme_name="Dental Nurse",
                start_date=date(2026, 1, 1),
                expected_end_date=date(2027, 1, 1),
                status=LearnerStatus.ON_BREAK,
            )
        ],
        pipeline_learners=[],
    )
    result = build_forecast(request)
    assert result.tutor_months[0].peak_caseload == 0
    assert result.tutor_months[0].remaining_capacity == 50


def test_pipeline_is_allocated_only_within_its_workstream() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 1),
        months=1,
        tutors=[
            Tutor(tutor_id="D1", tutor_name="Dental", workstream=Workstream.DENTAL),
            Tutor(tutor_id="P1", tutor_name="Pharmacy", workstream=Workstream.PHARMACY),
        ],
        existing_learners=[],
        pipeline_learners=[
            PipelineLearner(
                learner_id="PL1",
                programme_name="Pharmacy",
                workstream=Workstream.PHARMACY,
                start_date=date(2026, 8, 5),
                expected_end_date=date(2027, 8, 5),
            )
        ],
    )
    result = build_forecast(request)
    dental = next(row for row in result.tutor_months if row.tutor_id == "D1")
    pharmacy = next(row for row in result.tutor_months if row.tutor_id == "P1")
    assert dental.forecast_starts == 0
    assert pharmacy.forecast_starts == 1


def test_default_forecast_is_rolling_eighteen_months() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 11),
        tutors=[],
        existing_learners=[],
        pipeline_learners=[],
    )
    result = build_forecast(request)
    assert len(result.months) == 18
    assert result.months[0] == date(2026, 8, 1)
    assert result.months[-1] == date(2028, 1, 1)


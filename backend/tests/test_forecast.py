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


def test_zero_capacity_tutor_is_unavailable_without_division_error() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 1),
        months=1,
        tutors=[
            Tutor(
                tutor_id="T1",
                tutor_name="Unavailable Tutor",
                workstream=Workstream.BUSINESS,
                capacity=0,
            )
        ],
        existing_learners=[],
        pipeline_learners=[
            PipelineLearner(
                learner_id="PL1",
                programme_name="Business Administrator",
                workstream=Workstream.BUSINESS,
                start_date=date(2026, 8, 5),
                expected_end_date=date(2027, 8, 5),
            )
        ],
    )

    result = build_forecast(request)

    assert result.tutor_months[0].capacity == 0
    assert result.tutor_months[0].utilisation_percent == 0
    assert result.tutor_months[0].forecast_starts == 0
    assert [learner.learner_id for learner in result.unallocated_learners] == ["PL1"]
    business = next(
        row
        for row in result.workstream_months
        if row.workstream == Workstream.BUSINESS
    )
    assert business.additional_tutors_required == 1


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


def test_optional_history_precedes_the_current_month_without_reducing_the_forecast() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 9, 3),
        months=2,
        history_months=3,
        tutors=[],
        existing_learners=[],
        pipeline_learners=[],
    )

    result = build_forecast(request)

    assert result.generated_at == date(2026, 9, 3)
    assert result.months == [
        date(2026, 6, 1),
        date(2026, 7, 1),
        date(2026, 8, 1),
        date(2026, 9, 1),
        date(2026, 10, 1),
    ]


def test_operations_tutors_and_learners_are_excluded_from_all_forecast_calculations() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 1),
        months=1,
        tutors=[
            Tutor(
                tutor_id="OPS-1",
                tutor_name="Operations Tutor",
                workstream=Workstream.OPERATIONS,
                capacity=250,
            ),
            Tutor(
                tutor_id="BUS-1",
                tutor_name="Business Tutor",
                workstream=Workstream.BUSINESS,
                capacity=50,
            ),
        ],
        existing_learners=[
            ExistingLearner(
                learner_id="OPS-EXISTING",
                tutor_id="OPS-1",
                programme_name="Operations Manager",
                start_date=date(2026, 1, 1),
                expected_end_date=date(2027, 1, 1),
                status=LearnerStatus.IN_PROGRESS,
            )
        ],
        pipeline_learners=[
            PipelineLearner(
                learner_id="OPS-PIPELINE",
                programme_name="Operations Manager",
                workstream=Workstream.OPERATIONS,
                start_date=date(2026, 8, 5),
                expected_end_date=date(2027, 8, 5),
            )
        ],
    )

    result = build_forecast(request)

    assert {row.tutor_id for row in result.tutor_months} == {"BUS-1"}
    assert Workstream.OPERATIONS not in {
        row.workstream for row in result.workstream_months
    }
    assert result.unallocated_learners == []
    business = next(
        row
        for row in result.workstream_months
        if row.workstream == Workstream.BUSINESS
    )
    assert business.total_capacity == 50
    assert business.peak_projected_caseload == 0

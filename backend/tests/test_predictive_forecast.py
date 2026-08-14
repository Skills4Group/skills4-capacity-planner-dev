from datetime import date, datetime

from app.adapters.attendance import AttendanceLearnerRecord
from app.forecast import add_months
from app.models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    Tutor,
    Workstream,
)
from app.predictive_forecast import build_predictive_forecast


def attendance_record(
    learner_id: str,
    programme: str,
    start: date | None,
    end: date | None,
    tutor_id: str = "T-PHA",
) -> AttendanceLearnerRecord:
    return AttendanceLearnerRecord(
        learner_id=learner_id,
        tutor_id=tutor_id,
        tutor_name="Tutor",
        programme_name=programme,
        start_date=start,
        expected_end_date=end,
        status_desc="In Progress",
        synced_at=datetime(2026, 8, 14),
    )


def build_request(existing: list[ExistingLearner] | None = None) -> ForecastRequest:
    return ForecastRequest(
        as_of_date=date(2026, 8, 14),
        months=18,
        tutors=[
            Tutor(
                tutor_id="T-PHA",
                tutor_name="Pharmacy Tutor",
                workstream=Workstream.PHARMACY,
                capacity=50,
            ),
            Tutor(
                tutor_id="T-OPS",
                tutor_name="Operations Tutor",
                workstream=Workstream.OPERATIONS,
                capacity=250,
            ),
        ],
        existing_learners=existing or [],
        pipeline_learners=[],
    )


def test_historical_prediction_has_ordered_ranges_and_excludes_operations() -> None:
    records: list[AttendanceLearnerRecord] = []
    training_start = date(2023, 8, 1)
    for month_index in range(36):
        start = add_months(training_start, month_index)
        for learner_index in range(10):
            records.append(
                attendance_record(
                    f"PHA-{month_index}-{learner_index}",
                    "Pharmacy Services Assistant",
                    start,
                    add_months(start, 18),
                )
            )
        records.append(
            attendance_record(
                f"OPS-{month_index}",
                "Operations or Departmental Manager",
                start,
                add_months(start, 18),
                "T-OPS",
            )
        )

    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14),
        months=18,
        attendance_learners=records,
        forecast_request=build_request(),
        programme_mappings={},
    )

    assert len(response.months) == 18
    assert response.training_end == date(2026, 7, 1)
    assert {summary.workstream for summary in response.workstream_summaries} == {
        Workstream.DENTAL,
        Workstream.PHARMACY,
        Workstream.HOUSING,
        Workstream.SCIENCE,
        Workstream.BUSINESS,
    }
    pharmacy = next(
        summary
        for summary in response.workstream_summaries
        if summary.workstream == Workstream.PHARMACY
    )
    assert pharmacy.data_confidence == "High"
    assert pharmacy.historical_starts == 360
    for row in response.workstream_months:
        assert row.workstream != Workstream.OPERATIONS
        assert row.predicted_starts_p90 >= row.predicted_starts_p80
        assert row.predicted_starts_p80 >= row.predicted_starts_p50
        assert row.predicted_active_p90 >= row.predicted_active_p80
        assert row.predicted_active_p80 >= row.predicted_active_p50
        assert row.additional_tutors_p90 >= row.additional_tutors_p80
        assert row.additional_tutors_p80 >= row.additional_tutors_p50


def test_scheduled_end_date_removes_existing_learner_after_offboarding_month() -> None:
    existing = ExistingLearner(
        learner_id="ACTIVE-1",
        tutor_id="T-PHA",
        programme_name="Pharmacy Services Assistant",
        start_date=date(2025, 1, 1),
        expected_end_date=date(2026, 9, 15),
        status=LearnerStatus.IN_PROGRESS,
    )
    record = attendance_record(
        existing.learner_id,
        existing.programme_name,
        existing.start_date,
        existing.expected_end_date,
    )
    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14),
        months=2,
        attendance_learners=[record],
        forecast_request=build_request([existing]),
        programme_mappings={},
    )
    pharmacy_rows = [
        row
        for row in response.workstream_months
        if row.workstream == Workstream.PHARMACY
    ]
    assert pharmacy_rows[0].month == date(2026, 9, 1)
    assert pharmacy_rows[0].existing_active_learners == 1
    assert pharmacy_rows[1].month == date(2026, 10, 1)
    assert pharmacy_rows[1].existing_active_learners == 0


def test_sparse_history_is_labelled_low_confidence() -> None:
    record = attendance_record(
        "ONE",
        "Dental Nurse Apprenticeship",
        date(2026, 7, 1),
        date(2027, 12, 1),
        "T-DEN",
    )
    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14),
        months=3,
        attendance_learners=[record],
        forecast_request=build_request(),
        programme_mappings={},
    )
    dental = next(
        summary
        for summary in response.workstream_summaries
        if summary.workstream == Workstream.DENTAL
    )
    assert dental.data_confidence == "Low"

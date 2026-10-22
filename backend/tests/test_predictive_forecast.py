from datetime import date, datetime
from dataclasses import replace

from app.adapters.attendance import AttendanceLearnerRecord
from app.forecast import add_months
from app.models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    ProgrammePlanningRecord,
    PlannedCohortRecord,
    PipelineLearner,
    Tutor,
    Workstream,
)
from app.predictive_forecast import _duration_months, build_predictive_forecast


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


def test_typical_duration_uses_practical_not_programme_end() -> None:
    record = replace(
        attendance_record(
            "L1", "Pharmacy Services", date(2026, 1, 1), date(2028, 1, 1)
        ),
        practical_end_date=date(2027, 1, 1),
    )
    durations = _duration_months([record], {}, {})
    assert durations[Workstream.PHARMACY] == 12


def test_epa_is_not_current_predictive_capacity_demand() -> None:
    existing = ExistingLearner(
        learner_id="L1", tutor_id="T-PHA", programme_name="Pharmacy Services",
        start_date=date(2026, 1, 1), expected_end_date=date(2027, 1, 1),
        status=LearnerStatus.IN_END_POINT_ASSESSMENT,
        workstream=Workstream.PHARMACY,
    )
    record = replace(
        attendance_record(
            "L1", "Pharmacy Services", date(2026, 1, 1), date(2027, 1, 1)
        ),
        status_desc="In End Point Assessment",
    )
    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14), months=1,
        attendance_learners=[record], forecast_request=build_request([existing]),
        programme_mappings={},
    )
    pharmacy = next(
        row for row in response.workstream_summaries
        if row.workstream == Workstream.PHARMACY
    )
    assert pharmacy.current_active_learners == 0


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
    assert pharmacy_rows[0].scheduled_finishes == 1
    assert pharmacy_rows[1].month == date(2026, 10, 1)
    assert pharmacy_rows[1].existing_active_learners == 0
    assert pharmacy_rows[1].scheduled_finishes == 0


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


def test_predictive_rows_separate_pharmacy_l2_from_general() -> None:
    existing = ExistingLearner(
        learner_id="L2-ACTIVE",
        tutor_id="T-PHA",
        programme_name="Pharmacy L2",
        programme_code="pharmacy-l2",
        workstream=Workstream.PHARMACY,
        start_date=date(2026, 1, 1),
        expected_end_date=date(2026, 9, 20),
        status=LearnerStatus.IN_PROGRESS,
    )
    programmes = [
        ProgrammePlanningRecord(
            programme_code="pharmacy-general",
            display_name="Pharmacy (general)",
            workstream=Workstream.PHARMACY,
            duration_months=18,
            active=True,
        ),
        ProgrammePlanningRecord(
            programme_code="pharmacy-l2",
            display_name="Pharmacy L2",
            workstream=Workstream.PHARMACY,
            level="L2",
            duration_months=15,
            active=True,
        ),
    ]

    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14),
        months=1,
        attendance_learners=[
            attendance_record(
                existing.learner_id,
                existing.programme_name,
                existing.start_date,
                existing.expected_end_date,
            )
        ],
        forecast_request=build_request([existing]),
        programme_mappings={},
        programmes=programmes,
    )

    l2 = next(
        row
        for row in response.programme_months
        if row.programme_code == "pharmacy-l2"
    )
    general = next(
        row
        for row in response.programme_months
        if row.programme_code == "pharmacy-general"
    )
    assert l2.existing_active_learners == 1
    assert l2.scheduled_finishes == 1
    assert general.existing_active_learners == 0


def test_cross_workstream_learner_counts_in_its_own_workstream() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 8, 14), months=1,
        tutors=[Tutor(tutor_id="T1", tutor_name="Cross-stream tutor", workstream=Workstream.PHARMACY)],
        existing_learners=[ExistingLearner(
            learner_id="D1", tutor_id="T1", programme_name="Dental Nurse",
            workstream=Workstream.DENTAL, start_date=date(2026, 1, 1),
            expected_end_date=date(2027, 1, 1), status=LearnerStatus.IN_PROGRESS,
        )], pipeline_learners=[],
    )
    result = build_predictive_forecast(
        as_of_date=request.as_of_date, months=1, attendance_learners=[],
        forecast_request=request, programme_mappings={},
    )
    assert next(row for row in result.workstream_months if row.workstream == Workstream.DENTAL).existing_active_learners == 1
    assert next(row for row in result.workstream_months if row.workstream == Workstream.PHARMACY).existing_active_learners == 0


def test_workstream_starts_include_combined_programme_minimums() -> None:
    programmes = [
        ProgrammePlanningRecord(programme_code=code, display_name=code,
                                workstream=Workstream.PHARMACY, duration_months=18, active=True)
        for code in ("pharmacy-l2", "pharmacy-l3")
    ]
    request = ForecastRequest(
        as_of_date=date(2026, 10, 1), months=1, tutors=[], existing_learners=[],
        pipeline_learners=[PipelineLearner(
            learner_id=f"L{i}", programme_name="Pharmacy L2", programme_code="pharmacy-l2",
            workstream=Workstream.PHARMACY, start_date=date(2026, 11, 1),
            expected_end_date=date(2027, 11, 1),
        ) for i in range(15)],
    )
    result = build_predictive_forecast(
        as_of_date=request.as_of_date, months=1, attendance_learners=[],
        forecast_request=request, programme_mappings={}, programmes=programmes,
        planned_cohorts=[PlannedCohortRecord(
            programme_code="pharmacy-l3", start_month=date(2026, 11, 1),
            academic_year="2026/27", planned_starts=20,
        )],
    )
    stream = next(row for row in result.workstream_months if row.workstream == Workstream.PHARMACY)
    programme_rows = [row for row in result.programme_months if row.workstream == Workstream.PHARMACY]
    assert stream.predicted_starts_p50 == sum(row.predicted_starts_p50 for row in programme_rows) == 35
    assert stream.predicted_active_p50 == sum(row.predicted_active_p50 for row in programme_rows) == 35


def test_future_dated_attendance_starter_is_not_counted_twice() -> None:
    programme = ProgrammePlanningRecord(
        programme_code="pharmacy-l2", display_name="Pharmacy L2",
        workstream=Workstream.PHARMACY, duration_months=15, active=True,
    )
    learner = ExistingLearner(
        learner_id="FUTURE", tutor_id="T-PHA", programme_name="Pharmacy L2",
        programme_code="pharmacy-l2", workstream=Workstream.PHARMACY,
        start_date=date(2026, 9, 1), expected_end_date=date(2027, 11, 30),
        status=LearnerStatus.IN_PROGRESS,
    )
    request = build_request([learner])
    response = build_predictive_forecast(
        as_of_date=date(2026, 8, 14), months=1, attendance_learners=[],
        forecast_request=request, programme_mappings={}, programmes=[programme],
    )
    stream = next(row for row in response.workstream_months if row.workstream == Workstream.PHARMACY)
    programme_row = response.programme_months[0]
    assert stream.existing_active_learners == 1
    assert stream.predicted_starts_p50 == 1
    assert stream.predicted_active_p50 == 1
    assert programme_row.predicted_active_p50 == 1

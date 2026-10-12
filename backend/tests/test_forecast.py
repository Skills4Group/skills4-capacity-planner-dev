from datetime import date

from app.forecast import build_forecast
from app.models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    PipelineLearner,
    PlannedCohortRecord,
    ProgrammePlanningRecord,
    Tutor,
    TutorCapacityAllocation,
    UnallocatedExistingLearner,
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


def test_current_snapshot_uses_as_of_day_and_excludes_pipeline_and_breaks() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 10, 12), months=1,
        tutors=[Tutor(
            tutor_id="T1", tutor_name="Returning tutor", workstream=Workstream.PHARMACY,
            capacity=50, available_from=date(2026, 10, 10),
            programme_allocations=[TutorCapacityAllocation(
                programme_code="pharmacy-l3", programme_name="Pharmacy L3",
                workstream=Workstream.PHARMACY, capacity=50,
            )],
        )],
        existing_learners=[
            ExistingLearner(
                learner_id="active", tutor_id="T1", programme_name="Pharmacy L3",
                programme_code="pharmacy-l3", workstream=Workstream.PHARMACY,
                start_date=date(2026, 10, 2), expected_end_date=date(2026, 10, 20),
                status=LearnerStatus.IN_PROGRESS,
            ),
            ExistingLearner(
                learner_id="break", tutor_id="T1", programme_name="Pharmacy L3",
                programme_code="pharmacy-l3", workstream=Workstream.PHARMACY,
                start_date=date(2026, 9, 1), expected_end_date=date(2027, 1, 1),
                status=LearnerStatus.ON_BREAK,
            ),
        ],
        unallocated_existing_learners=[UnallocatedExistingLearner(
            learner_id="unallocated", programme_name="Pharmacy L3",
            programme_code="pharmacy-l3", workstream=Workstream.PHARMACY,
            start_date=date(2026, 9, 1), expected_end_date=date(2027, 1, 1),
            status=LearnerStatus.IN_PROGRESS,
        )],
        pipeline_learners=[PipelineLearner(
            learner_id="pipeline", programme_name="Pharmacy L3",
            programme_code="pharmacy-l3", workstream=Workstream.PHARMACY,
            start_date=date(2026, 10, 1), expected_end_date=date(2027, 1, 1),
        )],
    )
    result = build_forecast(request)
    monthly = next(row for row in result.workstream_months if row.workstream == Workstream.PHARMACY)
    current = next(row for row in result.current_workstream_snapshots if row.workstream == Workstream.PHARMACY)
    programme = next(row for row in result.current_programme_snapshots if row.programme_code == "pharmacy-l3")
    assert monthly.total_capacity == 0  # Monthly denominator is effective on 1 October.
    assert current.learners == programme.learners == 2
    assert current.capacity == programme.capacity == 50
    assert current.remaining_places == 48
    assert current.utilisation_percent == 4.0
    assert result.current_total_snapshot is not None
    assert result.current_total_snapshot.learners == 2
    assert result.current_total_snapshot.tutors == 1


def test_current_total_counts_cross_workstream_tutor_once() -> None:
    result = build_forecast(ForecastRequest(
        as_of_date=date(2026, 10, 12), months=1,
        tutors=[Tutor(
            tutor_id="T1", tutor_name="Mixed tutor", workstream=Workstream.PHARMACY,
            capacity=50,
            programme_allocations=[
                TutorCapacityAllocation(
                    programme_code="pharmacy-l3", programme_name="Pharmacy L3",
                    workstream=Workstream.PHARMACY, capacity=30,
                ),
                TutorCapacityAllocation(
                    programme_code="dental-general", programme_name="Dental",
                    workstream=Workstream.DENTAL, capacity=20,
                ),
            ],
        )], existing_learners=[], pipeline_learners=[],
    ))
    assert result.current_total_snapshot is not None
    assert result.current_total_snapshot.tutors == 1
    assert result.current_total_snapshot.capacity == 50


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


def test_tutor_capacity_can_be_split_across_programmes_and_workstreams() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 9, 1),
        months=1,
        tutors=[
            Tutor(
                tutor_id="T1",
                tutor_name="Cross-stream Tutor",
                workstream=Workstream.PHARMACY,
                capacity=50,
                programme_allocations=[
                    TutorCapacityAllocation(
                        programme_code="pharmacy-l3",
                        programme_name="Pharmacy L3",
                        workstream=Workstream.PHARMACY,
                        capacity=30,
                    ),
                    TutorCapacityAllocation(
                        programme_code="dental-general",
                        programme_name="Dental (general)",
                        workstream=Workstream.DENTAL,
                        capacity=20,
                    ),
                ],
            )
        ],
        existing_learners=[
            ExistingLearner(
                learner_id="L3-1",
                tutor_id="T1",
                programme_name="Pharmacy L3",
                programme_code="pharmacy-l3",
                workstream=Workstream.PHARMACY,
                start_date=date(2026, 1, 1),
                expected_end_date=date(2027, 1, 1),
                status=LearnerStatus.IN_PROGRESS,
            )
        ],
        pipeline_learners=[],
    )

    result = build_forecast(request)
    rows = {
        row.workstream: row
        for row in result.tutor_months
        if row.tutor_id == "T1"
    }

    assert rows[Workstream.PHARMACY].capacity == 30
    assert rows[Workstream.DENTAL].capacity == 20
    pharmacy = next(
        row for row in result.workstream_months
        if row.workstream == Workstream.PHARMACY
    )
    dental = next(
        row for row in result.workstream_months
        if row.workstream == Workstream.DENTAL
    )
    assert pharmacy.total_capacity == 30
    assert dental.total_capacity == 20
    pharmacy_l3 = next(
        row
        for row in result.programme_months
        if row.programme_code == "pharmacy-l3"
    )
    assert pharmacy_l3.total_capacity == 30
    assert pharmacy_l3.peak_projected_caseload == 1
    tutor_l3 = next(
        row
        for row in result.tutor_programme_months
        if row.tutor_id == "T1" and row.programme_code == "pharmacy-l3"
    )
    assert tutor_l3.capacity == 30
    assert tutor_l3.peak_caseload == 1


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


def test_maternity_return_restores_capacity_from_return_month() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 9, 1),
        months=3,
        tutors=[
            Tutor(
                tutor_id="T1",
                tutor_name="Returning Tutor",
                workstream=Workstream.PHARMACY,
                capacity=40,
                available_from=date(2026, 11, 1),
            )
        ],
        existing_learners=[],
        pipeline_learners=[],
    )

    result = build_forecast(request)
    rows = [row for row in result.tutor_months if row.tutor_id == "T1"]

    assert [row.capacity for row in rows] == [0, 0, 40]
    assert [row.remaining_capacity for row in rows] == [0, 0, 40]


def test_zero_capacity_cannot_be_revived_by_programme_allocations() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 10, 1),
        months=1,
        tutors=[Tutor(
            tutor_id="T1", tutor_name="On leave", workstream=Workstream.PHARMACY,
            capacity=0,
            programme_allocations=[TutorCapacityAllocation(
                programme_code="pharmacy-l2", programme_name="Pharmacy L2",
                workstream=Workstream.PHARMACY, capacity=50,
            )],
        )],
        existing_learners=[], pipeline_learners=[],
    )
    result = build_forecast(request)
    assert result.tutor_months[0].capacity == 0
    assert result.tutor_programme_months[0].capacity == 0
    assert next(row for row in result.workstream_months if row.workstream == Workstream.PHARMACY).tutors == 0


def test_confirmed_future_tutor_contributes_only_during_employment_dates() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 10, 1), months=3,
        tutors=[Tutor(
            tutor_id="planned-tutor:1", tutor_name="Future tutor",
            workstream=Workstream.DENTAL, capacity=50,
            available_from=date(2026, 11, 1),
            available_until=date(2026, 11, 30),
        )],
        existing_learners=[], pipeline_learners=[],
    )
    rows = [row for row in build_forecast(request).workstream_months if row.workstream == Workstream.DENTAL]
    assert [row.total_capacity for row in rows] == [0, 50, 0]
    assert [row.tutors for row in rows] == [0, 1, 0]


def test_planned_programme_starts_fill_only_the_gap_after_known_starts() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 10, 1), months=2, tutors=[],
        existing_learners=[],
        pipeline_learners=[PipelineLearner(
            learner_id="known", programme_name="Pharmacy L2",
            programme_code="pharmacy-l2", workstream=Workstream.PHARMACY,
            start_date=date(2026, 11, 5), expected_end_date=date(2027, 11, 5),
        )],
    )
    result = build_forecast(
        request,
        programmes=[ProgrammePlanningRecord(
            programme_code="pharmacy-l2", display_name="Pharmacy L2",
            workstream=Workstream.PHARMACY, duration_months=15, active=True,
        )],
        planned_cohorts=[PlannedCohortRecord(
            programme_code="pharmacy-l2", start_month=date(2026, 11, 1),
            academic_year="2026/27", planned_starts=3,
        )],
    )
    november = next(row for row in result.workstream_months if row.workstream == Workstream.PHARMACY and row.month == date(2026, 11, 1))
    assert november.forecast_starts == 3
    assert november.peak_projected_caseload == 3
    assert len(result.unallocated_learners) == 3


def test_aggregate_peak_uses_same_day_for_assigned_and_unallocated_demand() -> None:
    request = ForecastRequest(
        as_of_date=date(2026, 10, 1), months=1,
        tutors=[Tutor(tutor_id="T1", tutor_name="Tutor", workstream=Workstream.DENTAL, capacity=0)],
        existing_learners=[ExistingLearner(
            learner_id="first-half", tutor_id="T1", programme_name="Dental",
            programme_code="dental-general", workstream=Workstream.DENTAL,
            start_date=date(2026, 1, 1), expected_end_date=date(2026, 10, 10),
            status=LearnerStatus.IN_PROGRESS,
        )],
        pipeline_learners=[PipelineLearner(
            learner_id="second-half", programme_name="Dental",
            programme_code="dental-general", workstream=Workstream.DENTAL,
            start_date=date(2026, 10, 20), expected_end_date=date(2027, 10, 20),
        )],
    )
    result = build_forecast(request)
    stream = next(row for row in result.workstream_months if row.workstream == Workstream.DENTAL)
    programme = next(row for row in result.programme_months if row.programme_code == "dental-general")
    assert stream.peak_projected_caseload == 1
    assert programme.peak_projected_caseload == 1


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


def test_reporting_allocation_is_kept_when_primary_workstream_is_operations() -> None:
    result = build_forecast(ForecastRequest(
        as_of_date=date(2026, 10, 1), months=1,
        tutors=[Tutor(
            tutor_id="T1", tutor_name="Mixed tutor", workstream=Workstream.OPERATIONS,
            capacity=20,
            programme_allocations=[TutorCapacityAllocation(
                programme_code="business-general", programme_name="Business",
                workstream=Workstream.BUSINESS, capacity=20,
            )],
        )], existing_learners=[], pipeline_learners=[],
    ))
    business = next(row for row in result.workstream_months if row.workstream == Workstream.BUSINESS)
    assert business.total_capacity == 20
    assert business.tutors == 1

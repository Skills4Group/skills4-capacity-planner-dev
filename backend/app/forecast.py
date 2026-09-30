from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date, timedelta
from math import ceil

from .models import (
    CAPACITY_CONSUMING_STATUSES,
    ExistingLearner,
    ForecastRequest,
    ForecastResponse,
    PipelineLearner,
    ProgrammeMonth,
    REPORTING_WORKSTREAMS,
    Tutor,
    TutorMonth,
    TutorProgrammeMonth,
    UnallocatedLearner,
    Workstream,
    WorkstreamMonth,
)
from .programme_classification import programme_display_name


@dataclass(frozen=True)
class AssignedLearner:
    learner_id: str
    tutor_id: str
    workstream: Workstream
    start_date: date
    end_date: date
    source: str
    programme_code: str
    programme_name: str


def month_start(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, amount: int) -> date:
    month_index = value.month - 1 + amount
    return date(value.year + month_index // 12, month_index % 12 + 1, 1)


def month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def active_on(record: AssignedLearner, day: date) -> bool:
    return record.start_date <= day <= record.end_date


def tutor_capacity_on(tutor: Tutor, day: date) -> int:
    if tutor.available_from is not None and day < tutor.available_from:
        return 0
    return tutor.capacity


def tutor_stream_capacities_on(tutor: Tutor, day: date) -> dict[Workstream, int]:
    available = tutor.available_from is None or day >= tutor.available_from
    if tutor.programme_allocations:
        capacities: dict[Workstream, int] = {}
        for allocation in tutor.programme_allocations:
            capacities[allocation.workstream] = (
                capacities.get(allocation.workstream, 0)
                + (allocation.capacity if available else 0)
            )
        return capacities
    return {tutor.workstream: tutor.capacity if available else 0}


def tutor_stream_capacity_on(
    tutor: Tutor, workstream: Workstream, day: date
) -> int:
    return tutor_stream_capacities_on(tutor, day).get(workstream, 0)


def tutor_programme_capacities_on(
    tutor: Tutor, day: date
) -> dict[str, tuple[str, Workstream, int]]:
    available = tutor.available_from is None or day >= tutor.available_from
    if tutor.programme_allocations:
        return {
            allocation.programme_code: (
                allocation.programme_name,
                allocation.workstream,
                allocation.capacity if available else 0,
            )
            for allocation in tutor.programme_allocations
        }
    programme_code = f"{tutor.workstream.value.casefold()}-general"
    return {
        programme_code: (
            programme_display_name(programme_code),
            tutor.workstream,
            tutor.capacity if available else 0,
        )
    }


def tutor_programme_capacity_on(
    tutor: Tutor, programme_code: str | None, workstream: Workstream, day: date
) -> int:
    if programme_code is None:
        return tutor_stream_capacity_on(tutor, workstream, day)
    programme = tutor_programme_capacities_on(tutor, day).get(programme_code)
    return programme[2] if programme else 0


def days_in_month(start: date):
    current = start
    final = month_end(start)
    while current <= final:
        yield current
        current += timedelta(days=1)


def deduplicate_existing(
    learners: list[ExistingLearner], tutors: dict[str, Tutor]
) -> list[AssignedLearner]:
    latest_by_learner: dict[str, ExistingLearner] = {}
    for learner in learners:
        if learner.status not in CAPACITY_CONSUMING_STATUSES:
            continue
        if learner.tutor_id not in tutors:
            continue
        current = latest_by_learner.get(learner.learner_id)
        if current is None or learner.start_date > current.start_date:
            latest_by_learner[learner.learner_id] = learner

    return [
        AssignedLearner(
            learner_id=learner.learner_id,
            tutor_id=learner.tutor_id,
            workstream=learner.workstream or tutors[learner.tutor_id].workstream,
            start_date=learner.start_date,
            end_date=learner.expected_end_date,
            source="existing",
            programme_code=(
                learner.programme_code
                or f"{(learner.workstream or tutors[learner.tutor_id].workstream).value.casefold()}-general"
            ),
            programme_name=learner.programme_name,
        )
        for learner in latest_by_learner.values()
    ]


def allocate_pipeline(
    pipeline: list[PipelineLearner],
    tutors: dict[str, Tutor],
    assigned: list[AssignedLearner],
) -> tuple[list[AssignedLearner], list[UnallocatedLearner]]:
    allocations: list[AssignedLearner] = []
    unallocated: list[UnallocatedLearner] = []

    for learner in sorted(pipeline, key=lambda item: (item.start_date, item.learner_id)):
        candidates = [
            tutor
            for tutor in tutors.values()
            if tutor_programme_capacity_on(
                tutor,
                learner.programme_code,
                learner.workstream,
                learner.start_date,
            ) > 0
        ]

        def candidate_score(tutor: Tutor) -> tuple[float, int, str]:
            load = sum(
                1
                for record in (*assigned, *allocations)
                if record.tutor_id == tutor.tutor_id
                and record.workstream == learner.workstream
                and (
                    learner.programme_code is None
                    or record.programme_code == learner.programme_code
                )
                and active_on(record, learner.start_date)
            )
            capacity = tutor_programme_capacity_on(
                tutor,
                learner.programme_code,
                learner.workstream,
                learner.start_date,
            )
            return (load / capacity, load, tutor.tutor_id)

        candidates.sort(key=candidate_score)
        selected = next(
            (
                tutor
                for tutor in candidates
                if candidate_score(tutor)[1]
                < tutor_programme_capacity_on(
                    tutor,
                    learner.programme_code,
                    learner.workstream,
                    learner.start_date,
                )
            ),
            None,
        )

        if selected is None:
            unallocated.append(
                UnallocatedLearner(
                    learner_id=learner.learner_id,
                    workstream=learner.workstream,
                    start_date=learner.start_date,
                    expected_end_date=learner.expected_end_date,
                    programme_code=learner.programme_code,
                )
            )
            continue

        allocations.append(
            AssignedLearner(
                learner_id=learner.learner_id,
                tutor_id=selected.tutor_id,
                workstream=learner.workstream,
                start_date=learner.start_date,
                end_date=learner.expected_end_date,
                source="pipeline",
                programme_code=(
                    learner.programme_code
                    or f"{learner.workstream.value.casefold()}-general"
                ),
                programme_name=learner.programme_name,
            )
        )

    return allocations, unallocated


def distinct_active_count(records: list[AssignedLearner], day: date) -> int:
    return len({record.learner_id for record in records if active_on(record, day)})


def peak_count(records: list[AssignedLearner], start: date) -> int:
    return max(
        (distinct_active_count(records, day) for day in days_in_month(start)), default=0
    )


def build_forecast(request: ForecastRequest) -> ForecastResponse:
    tutors = {
        tutor.tutor_id: tutor
        for tutor in request.tutors
        if tutor.workstream in REPORTING_WORKSTREAMS
    }
    existing = deduplicate_existing(request.existing_learners, tutors)
    pipeline_allocations, unallocated = allocate_pipeline(
        [
            learner
            for learner in request.pipeline_learners
            if learner.workstream in REPORTING_WORKSTREAMS
        ],
        tutors,
        existing,
    )
    unallocated_existing = [
        UnallocatedLearner(
            learner_id=learner.learner_id,
            workstream=learner.workstream,
            start_date=learner.start_date,
            expected_end_date=learner.expected_end_date,
            programme_code=learner.programme_code,
        )
        for learner in request.unallocated_existing_learners
        if learner.status in CAPACITY_CONSUMING_STATUSES
        and learner.workstream in REPORTING_WORKSTREAMS
    ]
    all_assigned = [*existing, *pipeline_allocations]
    months = [
        add_months(month_start(request.as_of_date), index)
        for index in range(-request.history_months, request.months)
    ]
    tutor_months: list[TutorMonth] = []
    workstream_months: list[WorkstreamMonth] = []
    tutor_programme_months: list[TutorProgrammeMonth] = []
    programme_months: list[ProgrammeMonth] = []

    for month in months:
        end = month_end(month)
        for tutor in tutors.values():
            for tutor_workstream, monthly_capacity in tutor_stream_capacities_on(
                tutor, month
            ).items():
                records = [
                    record
                    for record in all_assigned
                    if record.tutor_id == tutor.tutor_id
                    and record.workstream == tutor_workstream
                ]
                opening = distinct_active_count(records, month)
                closing = distinct_active_count(records, end)
                peak = peak_count(records, month)
                remaining = monthly_capacity - peak
                existing_starts = len(
                {
                    record.learner_id
                    for record in records
                    if record.source == "existing"
                    and month <= record.start_date <= end
                }
            )
                forecast_starts = len(
                {
                    record.learner_id
                    for record in records
                    if record.source == "pipeline"
                    and month <= record.start_date <= end
                }
            )
                offboarded = len(
                {
                    record.learner_id
                    for record in records
                    if month <= record.end_date <= end
                }
            )
                tutor_months.append(
                    TutorMonth(
                    month=month,
                    tutor_id=tutor.tutor_id,
                    tutor_name=tutor.tutor_name,
                    workstream=tutor_workstream,
                    capacity=monthly_capacity,
                    active_cohorts=tutor.active_cohorts,
                    opening_caseload=opening,
                    existing_starts=existing_starts,
                    forecast_starts=forecast_starts,
                    offboarded=offboarded,
                    closing_caseload=closing,
                    peak_caseload=peak,
                    remaining_capacity=remaining,
                    utilisation_percent=(
                        round((peak / monthly_capacity) * 100, 1)
                        if monthly_capacity
                        else 0
                    ),
                    )
                )

            for programme_code, (
                programme_name,
                programme_workstream,
                programme_capacity,
            ) in tutor_programme_capacities_on(tutor, month).items():
                records = [
                    record
                    for record in all_assigned
                    if record.tutor_id == tutor.tutor_id
                    and record.programme_code == programme_code
                ]
                opening = distinct_active_count(records, month)
                closing = distinct_active_count(records, end)
                peak = peak_count(records, month)
                remaining = programme_capacity - peak
                tutor_programme_months.append(
                    TutorProgrammeMonth(
                        month=month,
                        tutor_id=tutor.tutor_id,
                        tutor_name=tutor.tutor_name,
                        workstream=programme_workstream,
                        programme_code=programme_code,
                        programme_name=programme_name,
                        capacity=programme_capacity,
                        active_cohorts=tutor.active_cohorts,
                        opening_caseload=opening,
                        existing_starts=len(
                            {
                                record.learner_id
                                for record in records
                                if record.source == "existing"
                                and month <= record.start_date <= end
                            }
                        ),
                        forecast_starts=len(
                            {
                                record.learner_id
                                for record in records
                                if record.source == "pipeline"
                                and month <= record.start_date <= end
                            }
                        ),
                        offboarded=len(
                            {
                                record.learner_id
                                for record in records
                                if month <= record.end_date <= end
                            }
                        ),
                        closing_caseload=closing,
                        peak_caseload=peak,
                        remaining_capacity=remaining,
                        utilisation_percent=(
                            round((peak / programme_capacity) * 100, 1)
                            if programme_capacity
                            else 0
                        ),
                    )
                )

        for workstream in REPORTING_WORKSTREAMS:
            stream_tutors = [
                tutor
                for tutor in tutors.values()
                if workstream in tutor_stream_capacities_on(tutor, month)
            ]
            stream_records = [
                record for record in all_assigned if record.workstream == workstream
            ]
            stream_pipeline_unallocated = [
                record
                for record in unallocated
                if record.workstream == workstream
                and record.start_date <= end
                and record.expected_end_date >= month
            ]
            stream_unallocated_existing = [
                record
                for record in unallocated_existing
                if record.workstream == workstream
                and record.start_date <= end
                and record.expected_end_date >= month
            ]
            stream_unallocated = [
                *stream_pipeline_unallocated,
                *stream_unallocated_existing,
            ]
            total_capacity = sum(
                tutor_stream_capacity_on(tutor, workstream, month)
                for tutor in stream_tutors
            )
            assigned_peak = peak_count(stream_records, month)
            unallocated_peak = max(
                (
                    len(
                        {
                            record.learner_id
                            for record in stream_unallocated
                            if record.start_date <= day <= record.expected_end_date
                        }
                    )
                    for day in days_in_month(month)
                ),
                default=0,
            )
            projected_peak = assigned_peak + unallocated_peak
            remaining = total_capacity - projected_peak
            stream_rows = [
                row
                for row in tutor_months
                if row.month == month and row.workstream == workstream
            ]
            workstream_months.append(
                WorkstreamMonth(
                    month=month,
                    workstream=workstream,
                    tutors=len(stream_tutors),
                    total_capacity=total_capacity,
                    opening_caseload=sum(row.opening_caseload for row in stream_rows)
                    + len(
                        {
                            record.learner_id
                            for record in stream_unallocated_existing
                            if record.start_date <= month <= record.expected_end_date
                        }
                    ),
                    forecast_starts=sum(row.forecast_starts for row in stream_rows)
                    + len(
                        {
                            record.learner_id
                            for record in stream_pipeline_unallocated
                            if month <= record.start_date <= end
                        }
                    ),
                    offboarded=sum(row.offboarded for row in stream_rows)
                    + len(
                        {
                            record.learner_id
                            for record in stream_unallocated_existing
                            if month <= record.expected_end_date <= end
                        }
                    ),
                    peak_projected_caseload=projected_peak,
                    remaining_capacity=remaining,
                    utilisation_percent=(
                        round((projected_peak / total_capacity) * 100, 1)
                        if total_capacity
                        else 0
                    ),
                    additional_tutors_required=ceil(max(0, -remaining) / 50),
                )
            )

        programme_definitions: dict[str, tuple[str, Workstream]] = {}
        for tutor in tutors.values():
            for programme_code, (
                programme_name,
                programme_workstream,
                _,
            ) in tutor_programme_capacities_on(tutor, month).items():
                programme_definitions[programme_code] = (
                    programme_name,
                    programme_workstream,
                )
        for record in all_assigned:
            programme_definitions.setdefault(
                record.programme_code,
                (programme_display_name(record.programme_code), record.workstream),
            )
        for record in (*unallocated, *unallocated_existing):
            if record.programme_code:
                programme_definitions.setdefault(
                    record.programme_code,
                    (programme_display_name(record.programme_code), record.workstream),
                )

        for programme_code, (
            programme_name,
            programme_workstream,
        ) in programme_definitions.items():
            programme_tutors = [
                tutor
                for tutor in tutors.values()
                if programme_code in tutor_programme_capacities_on(tutor, month)
            ]
            assigned_records = [
                record
                for record in all_assigned
                if record.programme_code == programme_code
            ]
            pipeline_unallocated = [
                record
                for record in unallocated
                if record.programme_code == programme_code
                and record.start_date <= end
                and record.expected_end_date >= month
            ]
            existing_unallocated = [
                record
                for record in unallocated_existing
                if record.programme_code == programme_code
                and record.start_date <= end
                and record.expected_end_date >= month
            ]
            all_unallocated = [*pipeline_unallocated, *existing_unallocated]
            total_capacity = sum(
                tutor_programme_capacity_on(
                    tutor, programme_code, programme_workstream, month
                )
                for tutor in programme_tutors
            )
            projected_peak = peak_count(assigned_records, month) + max(
                (
                    len(
                        {
                            record.learner_id
                            for record in all_unallocated
                            if record.start_date <= day <= record.expected_end_date
                        }
                    )
                    for day in days_in_month(month)
                ),
                default=0,
            )
            remaining = total_capacity - projected_peak
            programme_rows = [
                row
                for row in tutor_programme_months
                if row.month == month and row.programme_code == programme_code
            ]
            programme_months.append(
                ProgrammeMonth(
                    month=month,
                    workstream=programme_workstream,
                    programme_code=programme_code,
                    programme_name=programme_name,
                    tutors=len(programme_tutors),
                    total_capacity=total_capacity,
                    opening_caseload=sum(
                        row.opening_caseload for row in programme_rows
                    )
                    + len(
                        {
                            record.learner_id
                            for record in existing_unallocated
                            if record.start_date <= month <= record.expected_end_date
                        }
                    ),
                    forecast_starts=sum(
                        row.forecast_starts for row in programme_rows
                    )
                    + len(
                        {
                            record.learner_id
                            for record in pipeline_unallocated
                            if month <= record.start_date <= end
                        }
                    ),
                    offboarded=sum(row.offboarded for row in programme_rows)
                    + len(
                        {
                            record.learner_id
                            for record in existing_unallocated
                            if month <= record.expected_end_date <= end
                        }
                    ),
                    peak_projected_caseload=projected_peak,
                    remaining_capacity=remaining,
                    utilisation_percent=(
                        round((projected_peak / total_capacity) * 100, 1)
                        if total_capacity
                        else 0
                    ),
                    additional_tutors_required=ceil(max(0, -remaining) / 50),
                )
            )

    return ForecastResponse(
        generated_at=request.as_of_date,
        months=months,
        tutor_months=tutor_months,
        workstream_months=workstream_months,
        tutor_programme_months=tutor_programme_months,
        programme_months=programme_months,
        unallocated_learners=[*unallocated, *unallocated_existing],
    )

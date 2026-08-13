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
    REPORTING_WORKSTREAMS,
    Tutor,
    TutorMonth,
    UnallocatedLearner,
    Workstream,
    WorkstreamMonth,
)


@dataclass(frozen=True)
class AssignedLearner:
    learner_id: str
    tutor_id: str
    workstream: Workstream
    start_date: date
    end_date: date
    source: str


def month_start(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, amount: int) -> date:
    month_index = value.month - 1 + amount
    return date(value.year + month_index // 12, month_index % 12 + 1, 1)


def month_end(value: date) -> date:
    return value.replace(day=monthrange(value.year, value.month)[1])


def active_on(record: AssignedLearner, day: date) -> bool:
    return record.start_date <= day <= record.end_date


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
            workstream=tutors[learner.tutor_id].workstream,
            start_date=learner.start_date,
            end_date=learner.expected_end_date,
            source="existing",
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
            if tutor.workstream == learner.workstream and tutor.capacity > 0
        ]

        def candidate_score(tutor: Tutor) -> tuple[float, int, str]:
            load = sum(
                1
                for record in (*assigned, *allocations)
                if record.tutor_id == tutor.tutor_id
                and active_on(record, learner.start_date)
            )
            return (load / tutor.capacity, load, tutor.tutor_id)

        candidates.sort(key=candidate_score)
        selected = next(
            (tutor for tutor in candidates if candidate_score(tutor)[1] < tutor.capacity),
            None,
        )

        if selected is None:
            unallocated.append(
                UnallocatedLearner(
                    learner_id=learner.learner_id,
                    workstream=learner.workstream,
                    start_date=learner.start_date,
                    expected_end_date=learner.expected_end_date,
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
    all_assigned = [*existing, *pipeline_allocations]
    months = [
        add_months(month_start(request.as_of_date), index)
        for index in range(request.months)
    ]
    tutor_months: list[TutorMonth] = []
    workstream_months: list[WorkstreamMonth] = []

    for month in months:
        end = month_end(month)
        for tutor in tutors.values():
            records = [
                record for record in all_assigned if record.tutor_id == tutor.tutor_id
            ]
            opening = distinct_active_count(records, month)
            closing = distinct_active_count(records, end)
            peak = peak_count(records, month)
            remaining = tutor.capacity - peak
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
                    workstream=tutor.workstream,
                    capacity=tutor.capacity,
                    opening_caseload=opening,
                    existing_starts=existing_starts,
                    forecast_starts=forecast_starts,
                    offboarded=offboarded,
                    closing_caseload=closing,
                    peak_caseload=peak,
                    remaining_capacity=remaining,
                    utilisation_percent=(
                        round((peak / tutor.capacity) * 100, 1)
                        if tutor.capacity
                        else 0
                    ),
                )
            )

        for workstream in REPORTING_WORKSTREAMS:
            stream_tutors = [
                tutor for tutor in tutors.values() if tutor.workstream == workstream
            ]
            stream_records = [
                record for record in all_assigned if record.workstream == workstream
            ]
            stream_unallocated = [
                record
                for record in unallocated
                if record.workstream == workstream
                and record.start_date <= end
                and record.expected_end_date >= month
            ]
            total_capacity = sum(tutor.capacity for tutor in stream_tutors)
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
                    opening_caseload=sum(row.opening_caseload for row in stream_rows),
                    forecast_starts=sum(row.forecast_starts for row in stream_rows)
                    + len(
                        {
                            record.learner_id
                            for record in stream_unallocated
                            if month <= record.start_date <= end
                        }
                    ),
                    offboarded=sum(row.offboarded for row in stream_rows),
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
        unallocated_learners=unallocated,
    )

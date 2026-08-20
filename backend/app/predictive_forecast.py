from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date
from math import ceil, sqrt
from statistics import median

from .adapters.attendance import AttendanceLearnerRecord
from .forecast import add_months, month_end, month_start
from .live_forecast import map_programme
from .models import (
    CAPACITY_CONSUMING_STATUSES,
    ForecastRequest,
    PredictiveForecastResponse,
    PredictiveWorkstreamMonth,
    PredictiveWorkstreamSummary,
    REPORTING_WORKSTREAMS,
    Workstream,
)


NEW_TUTOR_CAPACITY = 50
MAX_TRAINING_MONTHS = 36
DEFAULT_DURATION_MONTHS = 18


def _month_distance(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + end.month - start.month


def _month_sequence(start: date, count: int) -> list[date]:
    return [add_months(start, index) for index in range(count)]


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    fraction = position - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * fraction


def _median_absolute_deviation(values: list[float]) -> float:
    if not values:
        return 0.0
    centre = median(values)
    return float(median(abs(value - centre) for value in values))


def _bounded_history(values: list[int]) -> list[float]:
    if not values:
        return []
    centre = float(median(values))
    spread = _median_absolute_deviation([float(value) for value in values])
    mean = sum(values) / len(values)
    upper = max(
        _percentile([float(value) for value in values], 0.9),
        centre + 3 * max(spread, sqrt(mean + 1)),
    )
    return [min(float(value), upper) for value in values]


def _start_distribution(
    history_months: list[date], history_values: list[int], target: date, horizon: int
) -> tuple[int, int, int]:
    bounded = _bounded_history(history_values)
    if not bounded or not any(history_values):
        return 0, 0, 0

    recent = bounded[-6:]
    recent_mean = sum(recent) / len(recent)
    seasonal_values: list[float] = []
    for year_offset in range(1, 4):
        candidate = date(target.year - year_offset, target.month, 1)
        if candidate in history_months:
            seasonal_values.append(bounded[history_months.index(candidate)])
    if seasonal_values:
        weights = (0.6, 0.3, 0.1)[: len(seasonal_values)]
        seasonal = sum(
            value * weight for value, weight in zip(seasonal_values, weights)
        ) / sum(weights)
    else:
        seasonal = recent_mean

    prior = bounded[-12:-6]
    prior_mean = sum(prior) / len(prior) if prior else recent_mean
    if prior_mean <= 0:
        trend_ratio = 1.25 if recent_mean > 0 else 1.0
    else:
        trend_ratio = min(1.25, max(0.75, recent_mean / prior_mean))
    trend_strength = min((horizon + 1) / 12, 1.0) * 0.5
    trend_factor = 1 + (trend_ratio - 1) * trend_strength
    p50 = max(0, round((seasonal * 0.7 + recent_mean * 0.3) * trend_factor))

    year_differences = [
        float(history_values[index] - history_values[index - 12])
        for index in range(12, len(history_values))
    ]
    residual_scale = (
        1.4826 * _median_absolute_deviation(year_differences) / sqrt(2)
        if year_differences
        else _median_absolute_deviation([float(value) for value in history_values])
    )
    scale = max(1.0, sqrt(p50 + 0.5), residual_scale)
    p80 = max(p50, ceil(p50 + 1.282 * scale))
    p90 = max(p80, ceil(p50 + 1.645 * scale))
    return p50, p80, p90


def _record_workstream(
    record: AttendanceLearnerRecord,
    mappings: dict[str, Workstream],
    tutor_workstreams: dict[str, Workstream],
) -> Workstream | None:
    mapped = map_programme(record.programme_name, mappings)
    if mapped:
        return mapped
    if record.tutor_id:
        return tutor_workstreams.get(record.tutor_id)
    return None


def _duration_months(
    records: list[AttendanceLearnerRecord],
    mappings: dict[str, Workstream],
    tutor_workstreams: dict[str, Workstream],
) -> dict[Workstream, int]:
    durations: dict[Workstream, list[int]] = defaultdict(list)
    for record in records:
        workstream = _record_workstream(record, mappings, tutor_workstreams)
        if (
            workstream not in REPORTING_WORKSTREAMS
            or not record.start_date
            or not record.expected_end_date
            or record.expected_end_date < record.start_date
        ):
            continue
        days = (record.expected_end_date - record.start_date).days + 1
        durations[workstream].append(max(3, min(60, round(days / 30.4375))))
    return {
        workstream: (
            round(median(durations[workstream]))
            if durations[workstream]
            else DEFAULT_DURATION_MONTHS
        )
        for workstream in REPORTING_WORKSTREAMS
    }


def _confidence(months: int, starts: int) -> str:
    if months >= 24 and starts >= 200:
        return "High"
    if months >= 12 and starts >= 50:
        return "Medium"
    return "Low"


def build_predictive_forecast(
    *,
    as_of_date: date,
    months: int,
    attendance_learners: list[AttendanceLearnerRecord],
    forecast_request: ForecastRequest,
    programme_mappings: dict[str, Workstream],
) -> PredictiveForecastResponse:
    forecast_months = _month_sequence(add_months(month_start(as_of_date), 1), months)
    training_end = add_months(month_start(as_of_date), -1)
    training_start = add_months(training_end, -(MAX_TRAINING_MONTHS - 1))
    training_months = _month_sequence(training_start, MAX_TRAINING_MONTHS)

    tutors = {
        tutor.tutor_id: tutor
        for tutor in forecast_request.tutors
        if tutor.workstream in REPORTING_WORKSTREAMS
    }
    tutor_workstreams = {
        tutor_id: tutor.workstream for tutor_id, tutor in tutors.items()
    }
    capacities = Counter[Workstream]()
    for tutor in tutors.values():
        capacities[tutor.workstream] += tutor.capacity

    history_counts: dict[Workstream, Counter[date]] = defaultdict(Counter)
    earliest_history: dict[Workstream, date] = {}
    unmapped_with_start = 0
    missing_start = 0
    for record in attendance_learners:
        if not record.start_date:
            missing_start += 1
            continue
        start_month = month_start(record.start_date)
        if start_month > training_end:
            continue
        workstream = _record_workstream(record, programme_mappings, tutor_workstreams)
        if workstream not in REPORTING_WORKSTREAMS:
            unmapped_with_start += 1
            continue
        if training_start <= start_month <= training_end:
            history_counts[workstream][start_month] += 1
            earliest_history[workstream] = min(
                earliest_history.get(workstream, start_month), start_month
            )

    durations = _duration_months(
        attendance_learners, programme_mappings, tutor_workstreams
    )
    existing_by_stream = defaultdict(list)
    valid_statuses = {status.value for status in CAPACITY_CONSUMING_STATUSES}
    for learner in forecast_request.existing_learners:
        tutor = tutors.get(learner.tutor_id)
        if tutor and learner.status.value in valid_statuses:
            existing_by_stream[tutor.workstream].append(learner)
    for learner in forecast_request.unallocated_existing_learners:
        if (
            learner.workstream in REPORTING_WORKSTREAMS
            and learner.status.value in valid_statuses
        ):
            existing_by_stream[learner.workstream].append(learner)

    pipeline_counts: dict[Workstream, Counter[date]] = defaultdict(Counter)
    for learner in forecast_request.pipeline_learners:
        if learner.workstream in REPORTING_WORKSTREAMS:
            pipeline_counts[learner.workstream][month_start(learner.start_date)] += 1

    rows: list[PredictiveWorkstreamMonth] = []
    summaries: list[PredictiveWorkstreamSummary] = []
    for workstream in REPORTING_WORKSTREAMS:
        values = [history_counts[workstream][month] for month in training_months]
        historical_starts = sum(values)
        observed_months = (
            _month_distance(earliest_history[workstream], training_end) + 1
            if workstream in earliest_history
            else 0
        )
        observed_months = min(MAX_TRAINING_MONTHS, observed_months)
        duration = durations[workstream]
        predicted_starts: dict[str, list[int]] = {"p50": [], "p80": [], "p90": []}
        stream_rows: list[PredictiveWorkstreamMonth] = []

        for index, month in enumerate(forecast_months):
            p50, p80, p90 = _start_distribution(
                training_months, values, month, index
            )
            known_starts = pipeline_counts[workstream][month]
            starts = {
                "p50": max(p50, known_starts),
                "p80": max(p80, known_starts),
                "p90": max(p90, known_starts),
            }
            for key in predicted_starts:
                predicted_starts[key].append(starts[key])

            existing_active = len(
                {
                    learner.learner_id
                    for learner in existing_by_stream[workstream]
                    if learner.start_date <= month_end(month)
                    and learner.expected_end_date >= month
                }
            )

            active = {}
            for key in ("p50", "p80", "p90"):
                cohort_total = sum(
                    predicted_starts[key][cohort_index]
                    for cohort_index in range(index + 1)
                    if index - cohort_index < duration
                )
                active[key] = existing_active + cohort_total

            capacity = capacities[workstream]
            stream_rows.append(
                PredictiveWorkstreamMonth(
                    month=month,
                    workstream=workstream,
                    existing_active_learners=existing_active,
                    known_pipeline_starts=known_starts,
                    predicted_starts_p50=starts["p50"],
                    predicted_starts_p80=starts["p80"],
                    predicted_starts_p90=starts["p90"],
                    predicted_active_p50=active["p50"],
                    predicted_active_p80=active["p80"],
                    predicted_active_p90=active["p90"],
                    effective_capacity=capacity,
                    additional_tutors_p50=ceil(
                        max(0, active["p50"] - capacity) / NEW_TUTOR_CAPACITY
                    ),
                    additional_tutors_p80=ceil(
                        max(0, active["p80"] - capacity) / NEW_TUTOR_CAPACITY
                    ),
                    additional_tutors_p90=ceil(
                        max(0, active["p90"] - capacity) / NEW_TUTOR_CAPACITY
                    ),
                )
            )

        rows.extend(stream_rows)

        def first_shortage(level: str) -> date | None:
            return next(
                (
                    row.month
                    for row in stream_rows
                    if getattr(row, f"additional_tutors_{level}") > 0
                ),
                None,
            )

        current_active = len(
            {
                learner.learner_id
                for learner in existing_by_stream[workstream]
                if learner.start_date <= as_of_date <= learner.expected_end_date
            }
        )
        summaries.append(
            PredictiveWorkstreamSummary(
                workstream=workstream,
                historical_starts=historical_starts,
                historical_months=observed_months,
                median_duration_months=duration,
                data_confidence=_confidence(observed_months, historical_starts),
                current_active_learners=current_active,
                effective_capacity=capacities[workstream],
                peak_active_p50=max(row.predicted_active_p50 for row in stream_rows),
                peak_active_p80=max(row.predicted_active_p80 for row in stream_rows),
                peak_active_p90=max(row.predicted_active_p90 for row in stream_rows),
                peak_additional_tutors_p50=max(
                    row.additional_tutors_p50 for row in stream_rows
                ),
                peak_additional_tutors_p80=max(
                    row.additional_tutors_p80 for row in stream_rows
                ),
                peak_additional_tutors_p90=max(
                    row.additional_tutors_p90 for row in stream_rows
                ),
                first_shortage_month_p50=first_shortage("p50"),
                first_shortage_month_p80=first_shortage("p80"),
                first_shortage_month_p90=first_shortage("p90"),
            )
        )

    warnings = [
        "Predictions use each learner's latest Attendance record; historical status-transition dates are not available.",
        "The current partial month is excluded from training, and current tutor capacity is held constant across the horizon.",
        "Known pipeline starts are used as a minimum where they exceed the statistical prediction.",
    ]
    if missing_start:
        warnings.append(
            f"{missing_start:,} learner records without a start date were excluded from historical training."
        )
    if unmapped_with_start:
        warnings.append(
            f"{unmapped_with_start:,} dated learner records could not be mapped to a reporting workstream."
        )
    low_confidence = [
        summary.workstream.value
        for summary in summaries
        if summary.data_confidence == "Low"
    ]
    if low_confidence:
        warnings.append(
            "Low historical coverage: " + ", ".join(low_confidence) + "."
        )

    return PredictiveForecastResponse(
        generated_at=as_of_date,
        months=forecast_months,
        training_start=training_start,
        training_end=training_end,
        method_description=(
            "Robust seasonal forecast using up to 36 complete months of learner starts, "
            "a capped recent trend, scheduled learner end dates, typical programme duration, "
            "and P50/P80/P90 planning ranges."
        ),
        data_warnings=warnings,
        workstream_months=rows,
        workstream_summaries=summaries,
    )

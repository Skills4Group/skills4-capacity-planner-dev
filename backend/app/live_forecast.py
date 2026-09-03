from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import TutorSettingRecord, TutorStatusRecord
from .models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    PipelineLearner,
    Tutor,
    UnallocatedExistingLearner,
    Workstream,
)
from .tutor_identity import consolidate_tutor_inputs, consolidate_tutor_statuses


def map_programme(
    programme_name: str | None, configured: dict[str, Workstream]
) -> Workstream | None:
    if not programme_name:
        return None
    normalised = programme_name.strip().lower()
    if normalised in configured:
        return configured[normalised]
    if "pharmacy" in normalised:
        return Workstream.PHARMACY
    if "dental nurse" in normalised:
        return Workstream.DENTAL
    if "science manufacturing" in normalised or "laboratory technician" in normalised:
        return Workstream.SCIENCE
    if "housing" in normalised:
        return Workstream.HOUSING
    if "business" in normalised:
        return Workstream.BUSINESS
    if "operations" in normalised:
        return Workstream.OPERATIONS
    return None


def infer_tutor_workstreams(
    attendance_learners: list[AttendanceLearnerRecord],
    programme_mappings: dict[str, Workstream],
) -> dict[str, Workstream]:
    counts: dict[str, Counter[Workstream]] = defaultdict(Counter)
    for learner in attendance_learners:
        workstream = map_programme(learner.programme_name, programme_mappings)
        if learner.tutor_id and workstream:
            counts[learner.tutor_id][workstream] += 1
    return {
        tutor_id: sorted(
            workstreams.items(), key=lambda item: (-item[1], item[0].value)
        )[0][0]
        for tutor_id, workstreams in counts.items()
        if workstreams
    }


def build_live_request(
    *,
    as_of_date: date,
    months: int,
    attendance_learners: list[AttendanceLearnerRecord],
    attendance_tutors: list[AttendanceTutorRecord],
    tutor_settings: list[TutorSettingRecord],
    programme_mappings: dict[str, Workstream],
    pipeline_learners: list[PipelineLearner],
    tutor_statuses: list[TutorStatusRecord] | None = None,
    history_months: int = 0,
) -> ForecastRequest:
    tutor_statuses = consolidate_tutor_statuses(
        tutors=attendance_tutors,
        statuses=tutor_statuses or [],
    )
    attendance_learners, attendance_tutors, tutor_settings = consolidate_tutor_inputs(
        learners=attendance_learners,
        tutors=attendance_tutors,
        settings=tutor_settings,
    )
    settings_by_id = {setting.tutor_id: setting for setting in tutor_settings}
    statuses_by_id = {status.tutor_id: status for status in tutor_statuses}
    inactive_tutor_ids = {
        tutor_id for tutor_id, status in statuses_by_id.items() if not status.is_active
    }
    inferred = infer_tutor_workstreams(attendance_learners, programme_mappings)

    tutor_directory = {tutor.tutor_id: tutor for tutor in attendance_tutors}
    tutors: list[Tutor] = []
    for tutor_id, directory_record in tutor_directory.items():
        if tutor_id in inactive_tutor_ids:
            continue
        setting = settings_by_id.get(tutor_id)
        if setting:
            tutors.append(
                Tutor(
                    tutor_id=tutor_id,
                    tutor_name=setting.tutor_name or directory_record.tutor_name,
                    workstream=setting.workstream,
                    capacity=0 if setting.on_maternity_leave else setting.capacity,
                )
            )
        elif tutor_id in inferred:
            workstream = inferred[tutor_id]
            tutors.append(
                Tutor(
                    tutor_id=tutor_id,
                    tutor_name=directory_record.tutor_name,
                    workstream=workstream,
                )
            )

    # A Capacity-owned setting can explicitly add a tutor not present in the current
    # Attendance roster, while effective dating keeps old staff out of future runs.
    existing_tutor_ids = {tutor.tutor_id for tutor in tutors}
    for setting in tutor_settings:
        if (
            setting.tutor_id not in existing_tutor_ids
            and setting.tutor_id not in inactive_tutor_ids
        ):
            tutors.append(
                Tutor(
                    tutor_id=setting.tutor_id,
                    tutor_name=setting.tutor_name,
                    workstream=setting.workstream,
                    capacity=0 if setting.on_maternity_leave else setting.capacity,
                )
            )

    valid_tutor_ids = {tutor.tutor_id for tutor in tutors}
    valid_statuses = {status.value: status for status in LearnerStatus}
    existing_learners: list[ExistingLearner] = []
    unallocated_existing_learners: list[UnallocatedExistingLearner] = []
    for record in attendance_learners:
        if (
            not record.tutor_id
            or not record.start_date
            or not record.expected_end_date
            or record.status_desc not in valid_statuses
        ):
            continue
        if record.tutor_id in valid_tutor_ids:
            existing_learners.append(
                ExistingLearner(
                    learner_id=record.learner_id,
                    tutor_id=record.tutor_id,
                    programme_name=record.programme_name or "Unspecified programme",
                    start_date=record.start_date,
                    expected_end_date=record.expected_end_date,
                    status=valid_statuses[record.status_desc],
                )
            )
            continue
        if record.tutor_id not in inactive_tutor_ids:
            continue
        setting = settings_by_id.get(record.tutor_id)
        workstream = (
            setting.workstream
            if setting
            else map_programme(record.programme_name, programme_mappings)
            or inferred.get(record.tutor_id)
        )
        if workstream is None:
            continue
        unallocated_existing_learners.append(
            UnallocatedExistingLearner(
                learner_id=record.learner_id,
                programme_name=record.programme_name or "Unspecified programme",
                workstream=workstream,
                start_date=record.start_date,
                expected_end_date=record.expected_end_date,
                status=valid_statuses[record.status_desc],
            )
        )

    return ForecastRequest(
        as_of_date=as_of_date,
        months=months,
        history_months=history_months,
        tutors=sorted(tutors, key=lambda tutor: (tutor.workstream, tutor.tutor_name)),
        existing_learners=existing_learners,
        pipeline_learners=pipeline_learners,
        unallocated_existing_learners=unallocated_existing_learners,
    )

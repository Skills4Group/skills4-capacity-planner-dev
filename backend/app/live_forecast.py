from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date

from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import TutorSettingRecord
from .models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    PipelineLearner,
    Tutor,
    Workstream,
)


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
    return None


def build_live_request(
    *,
    as_of_date: date,
    months: int,
    attendance_learners: list[AttendanceLearnerRecord],
    attendance_tutors: list[AttendanceTutorRecord],
    tutor_settings: list[TutorSettingRecord],
    programme_mappings: dict[str, Workstream],
    pipeline_learners: list[PipelineLearner],
) -> ForecastRequest:
    settings_by_id = {setting.tutor_id: setting for setting in tutor_settings}
    inferred: dict[str, Counter[Workstream]] = defaultdict(Counter)
    for learner in attendance_learners:
        workstream = map_programme(learner.programme_name, programme_mappings)
        if learner.tutor_id and workstream:
            inferred[learner.tutor_id][workstream] += 1

    tutor_directory = {tutor.tutor_id: tutor for tutor in attendance_tutors}
    tutors: list[Tutor] = []
    for tutor_id, directory_record in tutor_directory.items():
        setting = settings_by_id.get(tutor_id)
        if setting:
            tutors.append(
                Tutor(
                    tutor_id=tutor_id,
                    tutor_name=setting.tutor_name or directory_record.tutor_name,
                    workstream=setting.workstream,
                    capacity=setting.capacity,
                )
            )
        elif inferred[tutor_id]:
            workstream = sorted(
                inferred[tutor_id].items(), key=lambda item: (-item[1], item[0].value)
            )[0][0]
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
        if setting.tutor_id not in existing_tutor_ids:
            tutors.append(
                Tutor(
                    tutor_id=setting.tutor_id,
                    tutor_name=setting.tutor_name,
                    workstream=setting.workstream,
                    capacity=setting.capacity,
                )
            )

    valid_tutor_ids = {tutor.tutor_id for tutor in tutors}
    valid_statuses = {status.value: status for status in LearnerStatus}
    existing_learners: list[ExistingLearner] = []
    for record in attendance_learners:
        if (
            not record.tutor_id
            or record.tutor_id not in valid_tutor_ids
            or not record.start_date
            or not record.expected_end_date
            or record.status_desc not in valid_statuses
        ):
            continue
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

    return ForecastRequest(
        as_of_date=as_of_date,
        months=months,
        tutors=sorted(tutors, key=lambda tutor: (tutor.workstream, tutor.tutor_name)),
        existing_learners=existing_learners,
        pipeline_learners=pipeline_learners,
    )

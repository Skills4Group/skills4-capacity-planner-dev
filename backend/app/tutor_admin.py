from __future__ import annotations

from datetime import date

from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import (
    TutorDiscoveryRecord,
    TutorSettingRecord,
    TutorStatusRecord,
)
from .live_forecast import infer_tutor_workstreams
from .models import CAPACITY_CONSUMING_STATUSES, TutorAdminRecord, Workstream
from .tutor_identity import consolidate_tutor_inputs, consolidate_tutor_statuses


def build_tutor_admin_records(
    *,
    as_of_date: date,
    attendance_learners: list[AttendanceLearnerRecord],
    attendance_tutors: list[AttendanceTutorRecord],
    tutor_settings: list[TutorSettingRecord],
    programme_mappings: dict[str, Workstream],
    tutor_discoveries: list[TutorDiscoveryRecord] | None = None,
    tutor_statuses: list[TutorStatusRecord] | None = None,
) -> list[TutorAdminRecord]:
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
    discoveries_by_id = {
        discovery.tutor_id: discovery for discovery in (tutor_discoveries or [])
    }
    statuses_by_id = {status.tutor_id: status for status in tutor_statuses}
    inferred = infer_tutor_workstreams(attendance_learners, programme_mappings)
    caseloads: dict[str, set[str]] = {}
    consuming_statuses = {status.value for status in CAPACITY_CONSUMING_STATUSES}
    for learner in attendance_learners:
        if (
            learner.tutor_id
            and learner.status_desc in consuming_statuses
            and learner.start_date
            and learner.expected_end_date
            and learner.start_date <= as_of_date <= learner.expected_end_date
        ):
            caseloads.setdefault(learner.tutor_id, set()).add(learner.learner_id)

    directory_by_id = {tutor.tutor_id: tutor for tutor in attendance_tutors}
    for setting in tutor_settings:
        directory_by_id.setdefault(
            setting.tutor_id,
            AttendanceTutorRecord(setting.tutor_id, setting.tutor_name),
        )
    for status in tutor_statuses:
        directory_by_id.setdefault(
            status.tutor_id,
            AttendanceTutorRecord(status.tutor_id, status.tutor_name),
        )

    records: list[TutorAdminRecord] = []
    for tutor in directory_by_id.values():
        setting = settings_by_id.get(tutor.tutor_id)
        discovery = discoveries_by_id.get(tutor.tutor_id)
        status = statuses_by_id.get(tutor.tutor_id)
        is_active = status.is_active if status else True
        workstream = setting.workstream if setting else inferred.get(tutor.tutor_id)
        capacity = setting.capacity if setting else 50
        on_maternity_leave = setting.on_maternity_leave if setting else False
        effective_capacity = 0 if on_maternity_leave or not is_active else capacity
        current_caseload = len(caseloads.get(tutor.tutor_id, set()))
        records.append(
            TutorAdminRecord(
                tutor_id=tutor.tutor_id,
                tutor_name=tutor.tutor_name,
                workstream=workstream,
                workstream_source=(
                    "saved" if setting else "inferred" if workstream else "unassigned"
                ),
                capacity=capacity,
                effective_capacity=effective_capacity,
                on_maternity_leave=on_maternity_leave,
                current_caseload=current_caseload,
                remaining_capacity=(
                    effective_capacity - current_caseload if is_active else 0
                ),
                has_saved_setting=setting is not None,
                is_active=is_active,
                status_updated_at=status.updated_at if status else None,
                status_updated_by=status.updated_by if status else None,
                is_new=discovery.is_new if discovery else False,
                first_seen_at=discovery.first_seen_at if discovery else None,
                acknowledged_at=(
                    discovery.acknowledged_at if discovery else None
                ),
                acknowledged_by=(
                    discovery.acknowledged_by if discovery else None
                ),
                updated_at=setting.updated_at if setting else None,
                updated_by=setting.updated_by if setting else None,
            )
        )
    return sorted(
        records,
        key=lambda record: (
            not record.is_active,
            record.workstream is None,
            record.workstream.value if record.workstream else "",
            record.tutor_name,
        ),
    )

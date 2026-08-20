from __future__ import annotations

from datetime import date

from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import TutorDiscoveryRecord, TutorSettingRecord
from .live_forecast import infer_tutor_workstreams
from .models import CAPACITY_CONSUMING_STATUSES, TutorAdminRecord, Workstream
from .tutor_identity import consolidate_tutor_inputs


def build_tutor_admin_records(
    *,
    as_of_date: date,
    attendance_learners: list[AttendanceLearnerRecord],
    attendance_tutors: list[AttendanceTutorRecord],
    tutor_settings: list[TutorSettingRecord],
    programme_mappings: dict[str, Workstream],
    tutor_discoveries: list[TutorDiscoveryRecord] | None = None,
) -> list[TutorAdminRecord]:
    attendance_learners, attendance_tutors, tutor_settings = consolidate_tutor_inputs(
        learners=attendance_learners,
        tutors=attendance_tutors,
        settings=tutor_settings,
    )
    settings_by_id = {setting.tutor_id: setting for setting in tutor_settings}
    discoveries_by_id = {
        discovery.tutor_id: discovery for discovery in (tutor_discoveries or [])
    }
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

    records: list[TutorAdminRecord] = []
    for tutor in attendance_tutors:
        setting = settings_by_id.get(tutor.tutor_id)
        discovery = discoveries_by_id.get(tutor.tutor_id)
        workstream = setting.workstream if setting else inferred.get(tutor.tutor_id)
        capacity = setting.capacity if setting else 50
        on_maternity_leave = setting.on_maternity_leave if setting else False
        effective_capacity = 0 if on_maternity_leave else capacity
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
                remaining_capacity=effective_capacity - current_caseload,
                has_saved_setting=setting is not None,
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
            record.workstream is None,
            record.workstream.value if record.workstream else "",
            record.tutor_name,
        ),
    )

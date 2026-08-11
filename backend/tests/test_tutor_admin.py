from datetime import date, datetime

from app.adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from app.adapters.capacity import TutorSettingRecord
from app.models import Workstream
from app.tutor_admin import build_tutor_admin_records


def attendance_learner(
    learner_id: str, tutor_id: str, programme: str, status: str = "In Progress"
) -> AttendanceLearnerRecord:
    return AttendanceLearnerRecord(
        learner_id=learner_id,
        tutor_id=tutor_id,
        tutor_name="Tutor",
        programme_name=programme,
        start_date=date(2026, 1, 1),
        expected_end_date=date(2027, 1, 1),
        status_desc=status,
        synced_at=datetime(2026, 8, 1),
    )


def test_tutor_directory_includes_idle_and_unassigned_tutors() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[attendance_learner("L1", "T1", "Pharmacy Services")],
        attendance_tutors=[
            AttendanceTutorRecord("T1", "Active Tutor"),
            AttendanceTutorRecord("T2", "Idle Tutor"),
        ],
        tutor_settings=[],
        programme_mappings={},
    )
    assert records[0].workstream == Workstream.PHARMACY
    assert records[0].current_caseload == 1
    assert records[0].capacity == 50
    assert records[1].workstream is None
    assert records[1].workstream_source == "unassigned"


def test_saved_capacity_overrides_default_and_break_does_not_use_space() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[
            attendance_learner("L1", "T1", "Dental Nurse", "On Break")
        ],
        attendance_tutors=[AttendanceTutorRecord("T1", "Tutor One")],
        tutor_settings=[
            TutorSettingRecord(
                "T1", "Tutor One", Workstream.DENTAL, 36, date(2026, 8, 1)
            )
        ],
        programme_mappings={},
    )
    assert records[0].capacity == 36
    assert records[0].current_caseload == 0
    assert records[0].remaining_capacity == 36
    assert records[0].workstream_source == "saved"

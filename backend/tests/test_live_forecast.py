from datetime import date, datetime

from app.adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from app.adapters.capacity import TutorSettingRecord
from app.live_forecast import build_live_request, map_programme
from app.models import Workstream


def learner(tutor_id: str, programme: str) -> AttendanceLearnerRecord:
    return AttendanceLearnerRecord(
        learner_id=f"L-{tutor_id}",
        tutor_id=tutor_id,
        tutor_name="Attendance Name",
        programme_name=programme,
        start_date=date(2026, 1, 1),
        expected_end_date=date(2027, 1, 1),
        status_desc="In Progress",
        synced_at=datetime(2026, 8, 1),
    )


def test_programme_mapping_uses_config_before_fallback() -> None:
    assert map_programme("Custom Programme", {"custom programme": Workstream.HOUSING}) == Workstream.HOUSING
    assert map_programme("Level 3 Pharmacy Technician", {}) == Workstream.PHARMACY
    assert map_programme("Business Administrator", {}) == Workstream.BUSINESS
    assert map_programme("Operations or Departmental Manager", {}) == Workstream.OPERATIONS


def test_capacity_setting_overrides_inferred_stream_and_default_capacity() -> None:
    request = build_live_request(
        as_of_date=date(2026, 8, 11),
        months=18,
        attendance_learners=[learner("T1", "Pharmacy Services")],
        attendance_tutors=[AttendanceTutorRecord("T1", "Tutor One")],
        tutor_settings=[
            TutorSettingRecord("T1", "Tutor One", Workstream.SCIENCE, 42)
        ],
        programme_mappings={},
        pipeline_learners=[],
    )
    assert request.tutors[0].workstream == Workstream.SCIENCE
    assert request.tutors[0].capacity == 42
    assert request.existing_learners[0].tutor_id == "T1"


def test_maternity_leave_preserves_setting_but_removes_forecast_capacity() -> None:
    request = build_live_request(
        as_of_date=date(2026, 8, 11),
        months=18,
        attendance_learners=[learner("T1", "Pharmacy Services")],
        attendance_tutors=[AttendanceTutorRecord("T1", "Tutor One")],
        tutor_settings=[
            TutorSettingRecord(
                "T1",
                "Tutor One",
                Workstream.PHARMACY,
                50,
                on_maternity_leave=True,
            )
        ],
        programme_mappings={},
        pipeline_learners=[],
    )

    assert request.tutors[0].capacity == 0
    assert request.existing_learners[0].tutor_id == "T1"


def test_unconfigured_idle_tutor_is_not_assigned_to_an_invented_workstream() -> None:
    request = build_live_request(
        as_of_date=date(2026, 8, 11),
        months=18,
        attendance_learners=[],
        attendance_tutors=[AttendanceTutorRecord("T-IDLE", "Idle Tutor")],
        tutor_settings=[],
        programme_mappings={},
        pipeline_learners=[],
    )
    assert request.tutors == []


def test_forecast_merges_internal_tutor_alias_and_preserves_latest_setting() -> None:
    request = build_live_request(
        as_of_date=date(2026, 8, 11),
        months=18,
        attendance_learners=[learner("attendance-internal:67", "Pharmacy Services")],
        attendance_tutors=[
            AttendanceTutorRecord("attendance-internal:67", "Sophie White"),
            AttendanceTutorRecord("EXTERNAL-SOPHIE", "Sophie White"),
        ],
        tutor_settings=[
            TutorSettingRecord(
                "EXTERNAL-SOPHIE",
                "Sophie White",
                Workstream.PHARMACY,
                50,
                date(2026, 8, 11),
                datetime(2026, 8, 11, 11, 0),
            ),
            TutorSettingRecord(
                "attendance-internal:67",
                "Sophie White",
                Workstream.PHARMACY,
                0,
                date(2026, 8, 11),
                datetime(2026, 8, 11, 12, 0),
            ),
        ],
        programme_mappings={},
        pipeline_learners=[],
    )

    assert len(request.tutors) == 1
    assert request.tutors[0].tutor_id == "EXTERNAL-SOPHIE"
    assert request.tutors[0].capacity == 0
    assert request.existing_learners[0].tutor_id == "EXTERNAL-SOPHIE"


def test_forecast_reconciles_unique_tutor_name_when_learner_id_differs() -> None:
    bud_learner = learner("B470ABCE-B20C-460F-802B-AFB80103219A", "Pharmacy Services")
    bud_learner = AttendanceLearnerRecord(
        learner_id=bud_learner.learner_id,
        tutor_id=bud_learner.tutor_id,
        tutor_name="Ceri Maunder",
        programme_name=bud_learner.programme_name,
        start_date=bud_learner.start_date,
        expected_end_date=bud_learner.expected_end_date,
        status_desc=bud_learner.status_desc,
        synced_at=bud_learner.synced_at,
    )
    request = build_live_request(
        as_of_date=date(2026, 8, 11),
        months=18,
        attendance_learners=[bud_learner],
        attendance_tutors=[
            AttendanceTutorRecord("attendance-internal:9", "Ceri Maunder")
        ],
        tutor_settings=[
            TutorSettingRecord(
                "attendance-internal:9",
                "Ceri Maunder",
                Workstream.PHARMACY,
                55,
            )
        ],
        programme_mappings={},
        pipeline_learners=[],
    )

    assert request.tutors[0].tutor_id == "attendance-internal:9"
    assert request.existing_learners[0].tutor_id == "attendance-internal:9"

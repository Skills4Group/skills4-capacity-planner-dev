from datetime import date, datetime, timezone

from app.adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from app.adapters.capacity import (
    TutorDiscoveryRecord,
    TutorIdentityAliasRecord,
    TutorSettingRecord,
    TutorStatusRecord,
)
from app.models import Workstream
from app.tutor_admin import build_tutor_admin_records
from app.tutor_identity import build_tutor_discovery_roster


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


def test_discovery_roster_includes_current_learner_assigned_tutor_missing_from_directory() -> None:
    learner = attendance_learner("L-HENRY", "HENRY-BUD-ID", "Pharmacy Services")
    learner = AttendanceLearnerRecord(
        learner_id=learner.learner_id,
        tutor_id=learner.tutor_id,
        tutor_name="Henry Baldry",
        programme_name=learner.programme_name,
        start_date=learner.start_date,
        expected_end_date=learner.expected_end_date,
        status_desc=learner.status_desc,
        synced_at=learner.synced_at,
    )

    roster = build_tutor_discovery_roster(
        tutors=[AttendanceTutorRecord("T-EXISTING", "Existing Tutor")],
        learners=[learner],
        as_of_date=date(2026, 8, 11),
    )

    assert [(tutor.tutor_id, tutor.tutor_name) for tutor in roster] == [
        ("T-EXISTING", "Existing Tutor"),
        ("HENRY-BUD-ID", "Henry Baldry"),
    ]


def test_discovery_roster_ignores_non_consuming_and_expired_assignments() -> None:
    on_break = attendance_learner("L-BREAK", "T-BREAK", "Pharmacy", "On Break")
    expired = AttendanceLearnerRecord(
        learner_id="L-EXPIRED",
        tutor_id="T-EXPIRED",
        tutor_name="Expired Tutor",
        programme_name="Pharmacy",
        start_date=date(2025, 1, 1),
        expected_end_date=date(2026, 7, 31),
        status_desc="In Progress",
        synced_at=datetime(2026, 8, 1),
    )

    roster = build_tutor_discovery_roster(
        tutors=[],
        learners=[on_break, expired],
        as_of_date=date(2026, 8, 11),
    )

    assert roster == []


def test_discovery_roster_reconciles_source_id_to_unique_directory_name() -> None:
    learner = attendance_learner("L1", "BUD-CERI", "Pharmacy Services")
    learner = AttendanceLearnerRecord(
        learner_id=learner.learner_id,
        tutor_id=learner.tutor_id,
        tutor_name=" Ceri  Maunder ",
        programme_name=learner.programme_name,
        start_date=learner.start_date,
        expected_end_date=learner.expected_end_date,
        status_desc=learner.status_desc,
        synced_at=learner.synced_at,
    )

    roster = build_tutor_discovery_roster(
        tutors=[AttendanceTutorRecord("attendance-internal:9", "Ceri Maunder")],
        learners=[learner],
        as_of_date=date(2026, 8, 11),
    )

    assert roster == [AttendanceTutorRecord("attendance-internal:9", "Ceri Maunder")]


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


def test_maternity_leave_preserves_configured_capacity_and_sets_effective_to_zero() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[
            attendance_learner("L1", "T1", "Business Administrator")
        ],
        attendance_tutors=[AttendanceTutorRecord("T1", "Tutor One")],
        tutor_settings=[
            TutorSettingRecord(
                "T1",
                "Tutor One",
                Workstream.BUSINESS,
                45,
                on_maternity_leave=True,
            )
        ],
        programme_mappings={},
    )

    assert records[0].capacity == 45
    assert records[0].effective_capacity == 0
    assert records[0].on_maternity_leave is True
    assert records[0].remaining_capacity == -1


def test_internal_alias_is_merged_into_unique_external_tutor() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[
            attendance_learner(
                "L1", "attendance-internal:67", "Pharmacy Services"
            )
        ],
        attendance_tutors=[
            AttendanceTutorRecord("attendance-internal:67", "Sophie White"),
            AttendanceTutorRecord("EXTERNAL-SOPHIE", "Sophie White"),
        ],
        tutor_settings=[
            TutorSettingRecord(
                "attendance-internal:67",
                "Sophie White",
                Workstream.PHARMACY,
                0,
                date(2026, 8, 11),
                datetime(2026, 8, 11, 12, 0),
                "Admin",
            )
        ],
        programme_mappings={},
    )

    assert len(records) == 1
    assert records[0].tutor_id == "EXTERNAL-SOPHIE"
    assert records[0].capacity == 0
    assert records[0].current_caseload == 1
    assert records[0].has_saved_setting is True


def test_same_name_external_tutors_are_not_merged_without_internal_alias() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[
            attendance_learner("L1", "BUD-ALEX", "Business Administrator")
        ],
        attendance_tutors=[
            AttendanceTutorRecord("EXTERNAL-1", "Alex Smith"),
            AttendanceTutorRecord("EXTERNAL-2", "Alex Smith"),
        ],
        tutor_settings=[],
        programme_mappings={},
    )

    assert {record.tutor_id for record in records} == {"EXTERNAL-1", "EXTERNAL-2"}
    assert all(record.current_caseload == 0 for record in records)


def test_unique_tutor_name_reconciles_bud_learner_id_to_internal_roster_id() -> None:
    learner_record = attendance_learner(
        "L1", "B470ABCE-B20C-460F-802B-AFB80103219A", "Pharmacy Services"
    )
    learner_record = AttendanceLearnerRecord(
        learner_id=learner_record.learner_id,
        tutor_id=learner_record.tutor_id,
        tutor_name="  Ceri   Maunder ",
        programme_name=learner_record.programme_name,
        start_date=learner_record.start_date,
        expected_end_date=learner_record.expected_end_date,
        status_desc=learner_record.status_desc,
        synced_at=learner_record.synced_at,
    )
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[learner_record],
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
    )

    assert len(records) == 1
    assert records[0].tutor_id == "attendance-internal:9"
    assert records[0].current_caseload == 1
    assert records[0].remaining_capacity == 54


def test_explicit_alias_reconciles_renamed_external_tutor_identity() -> None:
    source = attendance_learner(
        "L1", "423CEC9E-0471-40A5-9ADB-B43C00F63258", "Pharmacy Services"
    )
    renamed_learner = AttendanceLearnerRecord(
        learner_id=source.learner_id,
        tutor_id=source.tutor_id,
        tutor_name="Elouise Frost",
        programme_name=source.programme_name,
        start_date=source.start_date,
        expected_end_date=source.expected_end_date,
        status_desc=source.status_desc,
        synced_at=source.synced_at,
    )
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 11),
        attendance_learners=[renamed_learner],
        attendance_tutors=[AttendanceTutorRecord("attendance-internal:19", "Ellie Frost")],
        tutor_settings=[
            TutorSettingRecord(
                "attendance-internal:19",
                "Ellie Frost",
                Workstream.PHARMACY,
                50,
            )
        ],
        programme_mappings={},
        tutor_aliases=[
            TutorIdentityAliasRecord(
                "423CEC9E-0471-40A5-9ADB-B43C00F63258",
                "attendance-internal:19",
                "Elouise Frost",
                "Ellie Frost",
            )
        ],
    )

    assert len(records) == 1
    assert records[0].tutor_id == "attendance-internal:19"
    assert records[0].tutor_name == "Ellie Frost"
    assert records[0].current_caseload == 1


def test_unacknowledged_discovery_is_exposed_as_new_tutor() -> None:
    first_seen = datetime(2026, 8, 20, 9, 30, tzinfo=timezone.utc)
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 20),
        attendance_learners=[],
        attendance_tutors=[AttendanceTutorRecord("T-NEW", "New Tutor")],
        tutor_settings=[],
        programme_mappings={},
        tutor_discoveries=[
            TutorDiscoveryRecord(
                tutor_id="T-NEW",
                tutor_name="New Tutor",
                first_seen_at=first_seen,
                last_seen_at=first_seen,
                acknowledged_at=None,
                acknowledged_by=None,
                active_in_attendance=True,
            )
        ],
    )

    assert len(records) == 1
    assert records[0].is_new is True
    assert records[0].first_seen_at == first_seen
    assert records[0].workstream is None


def test_source_only_discovery_is_visible_without_contributing_capacity() -> None:
    first_seen = datetime(2026, 8, 20, 9, 30, tzinfo=timezone.utc)
    learner = attendance_learner("L-HENRY", "HENRY-BUD-ID", "Pharmacy Services")
    learner = AttendanceLearnerRecord(
        learner_id=learner.learner_id,
        tutor_id=learner.tutor_id,
        tutor_name="Henry Baldry",
        programme_name=learner.programme_name,
        start_date=learner.start_date,
        expected_end_date=learner.expected_end_date,
        status_desc=learner.status_desc,
        synced_at=learner.synced_at,
    )
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 20),
        attendance_learners=[learner],
        attendance_tutors=[],
        tutor_settings=[],
        programme_mappings={},
        tutor_discoveries=[
            TutorDiscoveryRecord(
                tutor_id="HENRY-BUD-ID",
                tutor_name="Henry Baldry",
                first_seen_at=first_seen,
                last_seen_at=first_seen,
                acknowledged_at=None,
                acknowledged_by=None,
                active_in_attendance=True,
            )
        ],
    )

    assert len(records) == 1
    assert records[0].is_new is True
    assert records[0].current_caseload == 1
    assert records[0].workstream == Workstream.PHARMACY
    assert records[0].capacity == 50
    assert records[0].delivery_eligible is False
    assert records[0].effective_capacity == 0
    assert records[0].remaining_capacity == 0


def test_acknowledged_discovery_is_not_exposed_as_new_tutor() -> None:
    first_seen = datetime(2026, 8, 20, 9, 30, tzinfo=timezone.utc)
    acknowledged = datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc)
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 20),
        attendance_learners=[],
        attendance_tutors=[AttendanceTutorRecord("T-REVIEWED", "Reviewed Tutor")],
        tutor_settings=[],
        programme_mappings={},
        tutor_discoveries=[
            TutorDiscoveryRecord(
                tutor_id="T-REVIEWED",
                tutor_name="Reviewed Tutor",
                first_seen_at=first_seen,
                last_seen_at=acknowledged,
                acknowledged_at=acknowledged,
                acknowledged_by="Admin User",
                active_in_attendance=True,
            )
        ],
    )

    assert records[0].is_new is False
    assert records[0].acknowledged_at == acknowledged
    assert records[0].acknowledged_by == "Admin User"


def test_inactive_tutor_remains_visible_with_zero_effective_capacity() -> None:
    updated = datetime(2026, 8, 20, 10, 0, tzinfo=timezone.utc)
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 20),
        attendance_learners=[
            attendance_learner("L1", "T-INACTIVE", "Pharmacy Services")
        ],
        attendance_tutors=[
            AttendanceTutorRecord("T-INACTIVE", "Departed Tutor")
        ],
        tutor_settings=[
            TutorSettingRecord(
                "T-INACTIVE",
                "Departed Tutor",
                Workstream.PHARMACY,
                50,
            )
        ],
        programme_mappings={},
        tutor_statuses=[
            TutorStatusRecord(
                "T-INACTIVE",
                "Departed Tutor",
                False,
                date(2026, 8, 20),
                updated,
                "Admin User",
            )
        ],
    )

    assert len(records) == 1
    assert records[0].is_active is False
    assert records[0].capacity == 50
    assert records[0].effective_capacity == 0
    assert records[0].current_caseload == 1
    assert records[0].remaining_capacity == 0
    assert records[0].status_updated_by == "Admin User"


def test_configured_tutor_missing_from_attendance_remains_visible_for_deactivation() -> None:
    records = build_tutor_admin_records(
        as_of_date=date(2026, 8, 20),
        attendance_learners=[],
        attendance_tutors=[],
        tutor_settings=[
            TutorSettingRecord(
                "T-STALE", "Former Tutor", Workstream.DENTAL, 35
            )
        ],
        programme_mappings={},
    )

    assert len(records) == 1
    assert records[0].tutor_id == "T-STALE"
    assert records[0].is_active is True
    assert records[0].has_saved_setting is True

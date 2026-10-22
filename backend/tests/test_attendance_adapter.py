from datetime import date

from app.adapters.attendance import (
    ACTIVE_COHORT_COUNTS_QUERY,
    ACTIVE_TUTORS_QUERY,
    LEARNER_PROGRESS_QUERY,
    AttendanceLearnerRecord,
)


def test_attendance_query_is_select_only_and_minimises_personal_data() -> None:
    normalised = " ".join(LEARNER_PROGRESS_QUERY.lower().split())
    assert normalised.startswith("select")
    assert "insert " not in normalised
    assert "update " not in normalised
    assert "delete " not in normalised
    assert "learner_email" not in normalised
    assert "learner_mobile" not in normalised
    assert "learner_name" not in normalised
    assert "left join public.learners" in normalised
    assert "l.planned_end_date as practical_end_date" in normalised
    assert "l.learner_ref = lp.learner_reference" in normalised
    assert "l.deleted_at is null" in normalised


def test_practical_end_date_replaces_programme_end_when_valid() -> None:
    record = AttendanceLearnerRecord(
        learner_id="L1", tutor_id="T1", tutor_name="Tutor",
        programme_name="Pharmacy", start_date=date(2024, 11, 27),
        expected_end_date=date(2026, 2, 19), status_desc="In Progress",
        synced_at=None, practical_end_date=date(2025, 11, 27),
    )
    assert record.capacity_end_date == date(2025, 11, 27)


def test_missing_or_pre_start_practical_end_falls_back_to_programme_end() -> None:
    base = dict(
        learner_id="L1", tutor_id="T1", tutor_name="Tutor",
        programme_name="Pharmacy", start_date=date(2024, 11, 27),
        expected_end_date=date(2026, 2, 19), status_desc="In Progress",
        synced_at=None,
    )
    assert AttendanceLearnerRecord(**base).capacity_end_date == date(2026, 2, 19)
    assert AttendanceLearnerRecord(
        **base, practical_end_date=date(2024, 11, 26)
    ).capacity_end_date == date(2026, 2, 19)


def test_practical_end_after_programme_end_can_reflect_an_extension() -> None:
    record = AttendanceLearnerRecord(
        learner_id="L1", tutor_id="T1", tutor_name="Tutor",
        programme_name="Pharmacy", start_date=date(2024, 11, 27),
        expected_end_date=date(2026, 2, 19), status_desc="In Progress",
        synced_at=None, practical_end_date=date(2026, 3, 1),
    )
    assert record.capacity_end_date == date(2026, 3, 1)


def test_tutor_query_is_select_only_and_omits_contact_details() -> None:
    normalised = " ".join(ACTIVE_TUTORS_QUERY.lower().split())
    assert normalised.startswith("select")
    assert "insert " not in normalised
    assert "update " not in normalised
    assert "delete " not in normalised
    assert "email" not in normalised
    assert "phone" not in normalised
    assert "attendance-internal:" in normalised
    assert "nullif(btrim(external_system_id::text), '')" in normalised


def test_active_cohort_query_uses_the_agreed_current_cohort_definition() -> None:
    normalised = " ".join(ACTIVE_COHORT_COUNTS_QUERY.lower().split())
    assert normalised.startswith("select")
    assert "count(distinct c.id)" in normalised
    assert "c.active is true" in normalised
    assert "c.deleted_at is null" in normalised
    assert "c.start_date <= %(as_of_date)s" in normalised
    assert "c.end_date is null or c.end_date >= %(as_of_date)s" in normalised
    assert "insert " not in normalised
    assert "update " not in normalised
    assert "delete " not in normalised

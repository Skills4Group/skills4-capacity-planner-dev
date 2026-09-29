from app.adapters.attendance import (
    ACTIVE_COHORT_COUNTS_QUERY,
    ACTIVE_TUTORS_QUERY,
    LEARNER_PROGRESS_QUERY,
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

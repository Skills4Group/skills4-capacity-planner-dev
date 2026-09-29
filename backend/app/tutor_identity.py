from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import date

from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import (
    TutorIdentityAliasRecord,
    TutorSettingRecord,
    TutorStatusRecord,
)
from .models import CAPACITY_CONSUMING_STATUSES


INTERNAL_TUTOR_ID_PREFIX = "attendance-internal:"


def normalise_tutor_name(value: str | None) -> str:
    return " ".join((value or "").split()).casefold()


@dataclass(frozen=True)
class TutorIdentityMap:
    tutors: list[AttendanceTutorRecord]
    canonical_by_id: dict[str, str]
    canonical_by_name: dict[str, str]
    canonical_name_by_id: dict[str, str]

    def resolve(self, tutor_id: str | None, tutor_name: str | None) -> str | None:
        if tutor_id and tutor_id in self.canonical_by_id:
            return self.canonical_by_id[tutor_id]
        return self.canonical_by_name.get(normalise_tutor_name(tutor_name), tutor_id)


def build_tutor_identity_map(
    tutors: list[AttendanceTutorRecord],
    aliases: list[TutorIdentityAliasRecord] | None = None,
) -> TutorIdentityMap:
    groups: dict[str, list[AttendanceTutorRecord]] = defaultdict(list)
    for tutor in tutors:
        groups[normalise_tutor_name(tutor.tutor_name)].append(tutor)

    canonical_by_id = {tutor.tutor_id: tutor.tutor_id for tutor in tutors}
    canonical_by_name: dict[str, str] = {}
    canonical_name_by_id = {tutor.tutor_id: tutor.tutor_name for tutor in tutors}
    suppressed_ids: set[str] = set()

    for name_key, group in groups.items():
        # A learner feed may hold Bud's tutor ID while the active Attendance tutor
        # directory has only its internal fallback ID. A unique active tutor name
        # provides a deterministic bridge without changing either source record.
        if len(group) == 1 and name_key:
            canonical_by_name[name_key] = group[0].tutor_id
            continue

        external = [
            tutor
            for tutor in group
            if not tutor.tutor_id.startswith(INTERNAL_TUTOR_ID_PREFIX)
        ]
        internal = [
            tutor
            for tutor in group
            if tutor.tutor_id.startswith(INTERNAL_TUTOR_ID_PREFIX)
        ]
        # Only consolidate the unambiguous Attendance alias pattern: exactly one
        # external identity plus one or more fallback identities with the same name.
        if len(external) != 1 or not internal:
            continue
        canonical = external[0]
        canonical_by_name[name_key] = canonical.tutor_id
        for alias in internal:
            canonical_by_id[alias.tutor_id] = canonical.tutor_id
            canonical_name_by_id[alias.tutor_id] = canonical.tutor_name
            suppressed_ids.add(alias.tutor_id)

    # Explicit Capacity-owned aliases bridge renamed or historic source identities.
    # Only aliases whose canonical target exists in the active Attendance roster are
    # applied, preventing a stale mapping from creating a phantom active tutor.
    for alias in aliases or []:
        canonical_id = canonical_by_id.get(alias.canonical_tutor_id)
        if canonical_id is None:
            continue
        canonical_by_id[alias.alias_tutor_id] = canonical_id
        canonical_name_by_id[alias.alias_tutor_id] = canonical_name_by_id.get(
            canonical_id,
            alias.canonical_tutor_name or alias.alias_tutor_name or "",
        )
        alias_name_key = normalise_tutor_name(alias.alias_tutor_name)
        if alias_name_key:
            canonical_by_name[alias_name_key] = canonical_id

    return TutorIdentityMap(
        tutors=[tutor for tutor in tutors if tutor.tutor_id not in suppressed_ids],
        canonical_by_id=canonical_by_id,
        canonical_by_name=canonical_by_name,
        canonical_name_by_id=canonical_name_by_id,
    )


def build_tutor_discovery_roster(
    *,
    tutors: list[AttendanceTutorRecord],
    learners: list[AttendanceLearnerRecord],
    as_of_date: date,
    aliases: list[TutorIdentityAliasRecord] | None = None,
) -> list[AttendanceTutorRecord]:
    """Include current learner-assigned identities missing from the tutor directory.

    Attendance's tutor directory is the primary roster. The learner feed can,
    however, contain a newly assigned tutor before that identity is present in
    ``public.tutors``. Those identities must be surfaced for administrator review
    instead of being silently omitted from discovery and the tutor panel.
    """
    identities = build_tutor_identity_map(tutors, aliases)
    roster_by_id = {tutor.tutor_id: tutor for tutor in identities.tutors}
    consuming_statuses = {status.value for status in CAPACITY_CONSUMING_STATUSES}

    for learner in learners:
        if (
            not learner.tutor_id
            or not normalise_tutor_name(learner.tutor_name)
            or learner.status_desc not in consuming_statuses
            or (learner.start_date is not None and learner.start_date > as_of_date)
            or (
                learner.expected_end_date is not None
                and learner.expected_end_date < as_of_date
            )
        ):
            continue
        tutor_id = identities.resolve(learner.tutor_id, learner.tutor_name)
        if not tutor_id:
            continue
        roster_by_id.setdefault(
            tutor_id,
            AttendanceTutorRecord(
                tutor_id=tutor_id,
                tutor_name=" ".join((learner.tutor_name or "").split()),
            ),
        )

    return sorted(
        roster_by_id.values(),
        key=lambda tutor: (normalise_tutor_name(tutor.tutor_name), tutor.tutor_id),
    )


def consolidate_tutor_counts(
    *,
    counts: dict[str, int],
    tutors: list[AttendanceTutorRecord],
    aliases: list[TutorIdentityAliasRecord] | None = None,
) -> dict[str, int]:
    """Aggregate a tutor metric onto the same canonical identities used by the UI."""
    identities = build_tutor_identity_map(tutors, aliases)
    consolidated: dict[str, int] = {}
    for tutor_id, count in counts.items():
        canonical_id = identities.resolve(tutor_id, None) or tutor_id
        consolidated[canonical_id] = consolidated.get(canonical_id, 0) + count
    return consolidated


def _setting_rank(
    setting: TutorSettingRecord, original_id: str, canonical_id: str
) -> tuple[int, float, bool]:
    effective = setting.effective_from.toordinal() if setting.effective_from else -1
    updated = setting.updated_at.timestamp() if setting.updated_at else float("-inf")
    return effective, updated, original_id == canonical_id


def consolidate_tutor_inputs(
    *,
    learners: list[AttendanceLearnerRecord],
    tutors: list[AttendanceTutorRecord],
    settings: list[TutorSettingRecord],
    aliases: list[TutorIdentityAliasRecord] | None = None,
) -> tuple[
    list[AttendanceLearnerRecord],
    list[AttendanceTutorRecord],
    list[TutorSettingRecord],
]:
    identities = build_tutor_identity_map(tutors, aliases)
    remapped_learners = [
        replace(
            learner,
            tutor_id=identities.resolve(learner.tutor_id, learner.tutor_name),
        )
        for learner in learners
    ]

    selected_settings: dict[str, tuple[TutorSettingRecord, tuple[int, float, bool]]] = {}
    for setting in settings:
        original_id = setting.tutor_id
        canonical_id = identities.resolve(setting.tutor_id, setting.tutor_name)
        if canonical_id is None:
            continue
        canonical_name = identities.canonical_name_by_id.get(
            original_id, setting.tutor_name
        )
        remapped = replace(
            setting,
            tutor_id=canonical_id,
            tutor_name=canonical_name,
        )
        rank = _setting_rank(setting, original_id, canonical_id)
        current = selected_settings.get(canonical_id)
        if current is None or rank > current[1]:
            selected_settings[canonical_id] = remapped, rank

    return (
        remapped_learners,
        identities.tutors,
        [record for record, _ in selected_settings.values()],
    )


def consolidate_tutor_statuses(
    *,
    tutors: list[AttendanceTutorRecord],
    statuses: list[TutorStatusRecord],
    aliases: list[TutorIdentityAliasRecord] | None = None,
) -> list[TutorStatusRecord]:
    identities = build_tutor_identity_map(tutors, aliases)
    selected: dict[str, tuple[TutorStatusRecord, tuple[int, float, bool]]] = {}
    for status in statuses:
        original_id = status.tutor_id
        canonical_id = identities.resolve(status.tutor_id, status.tutor_name)
        if canonical_id is None:
            continue
        remapped = replace(
            status,
            tutor_id=canonical_id,
            tutor_name=identities.canonical_name_by_id.get(
                original_id, status.tutor_name
            ),
        )
        effective = (
            status.effective_from.toordinal() if status.effective_from else -1
        )
        updated = (
            status.updated_at.timestamp()
            if status.updated_at
            else float("-inf")
        )
        rank = effective, updated, original_id == canonical_id
        current = selected.get(canonical_id)
        if current is None or rank > current[1]:
            selected[canonical_id] = remapped, rank
    return [record for record, _ in selected.values()]

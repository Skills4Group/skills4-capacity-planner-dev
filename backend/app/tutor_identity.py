from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from .adapters.attendance import AttendanceLearnerRecord, AttendanceTutorRecord
from .adapters.capacity import TutorSettingRecord


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
) -> TutorIdentityMap:
    groups: dict[str, list[AttendanceTutorRecord]] = defaultdict(list)
    for tutor in tutors:
        groups[normalise_tutor_name(tutor.tutor_name)].append(tutor)

    canonical_by_id = {tutor.tutor_id: tutor.tutor_id for tutor in tutors}
    canonical_by_name: dict[str, str] = {}
    canonical_name_by_id = {tutor.tutor_id: tutor.tutor_name for tutor in tutors}
    suppressed_ids: set[str] = set()

    for name_key, group in groups.items():
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

    return TutorIdentityMap(
        tutors=[tutor for tutor in tutors if tutor.tutor_id not in suppressed_ids],
        canonical_by_id=canonical_by_id,
        canonical_by_name=canonical_by_name,
        canonical_name_by_id=canonical_name_by_id,
    )


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
) -> tuple[
    list[AttendanceLearnerRecord],
    list[AttendanceTutorRecord],
    list[TutorSettingRecord],
]:
    identities = build_tutor_identity_map(tutors)
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

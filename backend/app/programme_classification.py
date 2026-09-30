from __future__ import annotations

import re

from .models import ProgrammePlanningRecord, Workstream


PHARMACY_FILTER_CODES = ("pharmacy-general", "pharmacy-l2", "pharmacy-l3")


def normalise_programme_name(value: str | None) -> str:
    return " ".join((value or "").strip().casefold().split())


def resolve_programme_code(
    programme_name: str | None,
    *,
    workstream: Workstream | None,
    programmes: list[ProgrammePlanningRecord] | None = None,
    aliases: dict[str, str] | None = None,
) -> str | None:
    """Resolve a source programme to a Capacity-owned programme code.

    Configured aliases and catalogue names take precedence. The narrow Pharmacy
    level fallback only applies when the source name explicitly contains L2/L3
    or Level 2/3; other Pharmacy records remain in Pharmacy (general).
    """
    key = normalise_programme_name(programme_name)
    aliases = aliases or {}
    if key and key in aliases:
        return aliases[key]

    catalogue = {programme.programme_code: programme for programme in programmes or []}
    by_name = {
        normalise_programme_name(programme.display_name): programme.programme_code
        for programme in catalogue.values()
    }
    if key and key in by_name:
        return by_name[key]

    if workstream == Workstream.PHARMACY or "pharmacy" in key:
        # BUD's live programme titles describe the standard rather than its
        # apprenticeship level. Pharmacy Services Assistant is the Level 2
        # family and Pharmacy Technician is the Level 3 family, including
        # versioned, WSL and commercial-route variants.
        if "pharmacy services assistant" in key:
            return "pharmacy-l2"
        if "pharmacy technician" in key:
            return "pharmacy-l3"
        if re.search(r"(?:\blevel\s*2\b|\blvl\s*2\b|\bl2\b)", key):
            return "pharmacy-l2"
        if re.search(r"(?:\blevel\s*3\b|\blvl\s*3\b|\bl3\b)", key):
            return "pharmacy-l3"
        return "pharmacy-general"

    if workstream is not None:
        generic_code = f"{workstream.value.casefold()}-general"
        if not catalogue or generic_code in catalogue:
            return generic_code
    return None


def programme_display_name(
    programme_code: str,
    programmes: list[ProgrammePlanningRecord] | None = None,
) -> str:
    programme = next(
        (
            item
            for item in programmes or []
            if item.programme_code == programme_code
        ),
        None,
    )
    if programme is not None:
        return programme.display_name
    return {
        "pharmacy-general": "Pharmacy (general)",
        "pharmacy-l2": "Pharmacy L2",
        "pharmacy-l3": "Pharmacy L3",
    }.get(programme_code, programme_code.replace("-", " ").title())

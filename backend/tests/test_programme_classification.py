from app.models import Workstream
from app.programme_classification import resolve_programme_code


def classify(programme_name: str) -> str | None:
    return resolve_programme_code(
        programme_name,
        workstream=Workstream.PHARMACY,
    )


def test_bud_pharmacy_services_assistant_variants_are_level_2():
    assert classify("Pharmacy Services Assistant v3.1") == "pharmacy-l2"
    assert classify("Pharmacy Services Assistant v3.1 - WSL") == "pharmacy-l2"
    assert classify("Pharmacy Services Assistant v4.0 - 8 month - WSL") == "pharmacy-l2"


def test_bud_pharmacy_technician_variants_are_level_3():
    assert (
        classify(
            "Pharmacy Technician (Integrated) "
            "(Pharmacy Technician Training Programme) (version 3)"
        )
        == "pharmacy-l3"
    )
    assert classify("Pharmacy Technician (integrated) v1.4 - OA WSL") == "pharmacy-l3"
    assert (
        classify(
            "Pharmacy Technician (integrated) "
            "(Pharmacy Technician Training Programme) V1.2 - Commercial route"
        )
        == "pharmacy-l3"
    )


def test_unclassified_pharmacy_title_remains_general():
    assert classify("Pharmacy induction programme") == "pharmacy-general"

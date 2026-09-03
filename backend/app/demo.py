from datetime import date, timedelta

from .adapters.attendance import AttendanceLearnerRecord
from .forecast import build_forecast
from .models import (
    ExistingLearner,
    ForecastRequest,
    LearnerStatus,
    PipelineLearner,
    Tutor,
    Workstream,
)
from .predictive_forecast import build_predictive_forecast


DEMO_TUTORS = [
    Tutor(tutor_id="DEN-01", tutor_name="Amelia Hart", workstream=Workstream.DENTAL),
    Tutor(tutor_id="DEN-02", tutor_name="Imran Shah", workstream=Workstream.DENTAL),
    Tutor(tutor_id="DEN-03", tutor_name="Louise Bennett", workstream=Workstream.DENTAL, capacity=45),
    Tutor(tutor_id="PHA-01", tutor_name="Aisha Khan", workstream=Workstream.PHARMACY),
    Tutor(tutor_id="PHA-02", tutor_name="Marcus Reed", workstream=Workstream.PHARMACY),
    Tutor(tutor_id="PHA-03", tutor_name="Priya Nair", workstream=Workstream.PHARMACY),
    Tutor(tutor_id="PHA-04", tutor_name="Daniel Cole", workstream=Workstream.PHARMACY, capacity=45),
    Tutor(tutor_id="HOU-01", tutor_name="Carla Jones", workstream=Workstream.HOUSING),
    Tutor(tutor_id="HOU-02", tutor_name="Nathan Brooks", workstream=Workstream.HOUSING, capacity=45),
    Tutor(tutor_id="HOU-03", tutor_name="Megan Price", workstream=Workstream.HOUSING),
    Tutor(tutor_id="SCI-01", tutor_name="Sophie Turner", workstream=Workstream.SCIENCE),
    Tutor(tutor_id="SCI-02", tutor_name="Oliver Grant", workstream=Workstream.SCIENCE),
    Tutor(tutor_id="BUS-01", tutor_name="Hannah Wright", workstream=Workstream.BUSINESS),
    Tutor(tutor_id="BUS-02", tutor_name="George Patel", workstream=Workstream.BUSINESS, capacity=45),
    Tutor(tutor_id="OPS-01", tutor_name="Emma Collins", workstream=Workstream.OPERATIONS),
    Tutor(tutor_id="OPS-02", tutor_name="Ryan Walker", workstream=Workstream.OPERATIONS),
]

PROGRAMMES = {
    Workstream.DENTAL: "Dental Nurse Apprenticeship",
    Workstream.PHARMACY: "Pharmacy Services Assistant",
    Workstream.HOUSING: "Housing and Property Management",
    Workstream.SCIENCE: "Laboratory Technician",
    Workstream.BUSINESS: "Business Administrator",
    Workstream.OPERATIONS: "Operations or Departmental Manager",
}


def demo_request(as_of: date = date(2026, 8, 11)) -> ForecastRequest:
    existing: list[ExistingLearner] = []
    pipeline: list[PipelineLearner] = []

    for tutor_index, tutor in enumerate(DEMO_TUTORS):
        base_load = 32 + (tutor_index * 7) % 15
        for learner_index in range(base_load):
            start = as_of - timedelta(
                days=150 + ((learner_index * 13 + tutor_index) % 400)
            )
            end = as_of + timedelta(
                days=70 + ((learner_index * 29 + tutor_index * 11) % 650)
            )
            existing.append(
                ExistingLearner(
                    learner_id=f"EX-{tutor.tutor_id}-{learner_index:03d}",
                    tutor_id=tutor.tutor_id,
                    programme_name=PROGRAMMES[tutor.workstream],
                    start_date=start,
                    expected_end_date=end,
                    status=LearnerStatus.IN_PROGRESS,
                )
            )

    streams = list(Workstream)
    for learner_index in range(180):
        workstream = streams[(learner_index * 3 + learner_index // 9) % len(streams)]
        start = as_of + timedelta(days=12 + ((learner_index * 17) % 520))
        pipeline.append(
            PipelineLearner(
                learner_id=f"PL-{learner_index:04d}",
                programme_name=PROGRAMMES[workstream],
                workstream=workstream,
                start_date=start,
                expected_end_date=start
                + timedelta(days=420 + (learner_index % 5) * 45),
            )
        )

    return ForecastRequest(
        as_of_date=as_of,
        months=18,
        history_months=3,
        tutors=DEMO_TUTORS,
        existing_learners=existing,
        pipeline_learners=pipeline,
    )


def build_demo_forecast():
    return build_forecast(demo_request())


def build_demo_predictive_forecast():
    request = demo_request()
    tutor_names = {tutor.tutor_id: tutor.tutor_name for tutor in request.tutors}
    attendance_records = [
        AttendanceLearnerRecord(
            learner_id=learner.learner_id,
            tutor_id=learner.tutor_id,
            tutor_name=tutor_names.get(learner.tutor_id),
            programme_name=learner.programme_name,
            start_date=learner.start_date,
            expected_end_date=learner.expected_end_date,
            status_desc=learner.status.value,
            synced_at=None,
        )
        for learner in request.existing_learners
    ]
    return build_predictive_forecast(
        as_of_date=request.as_of_date,
        months=request.months,
        attendance_learners=attendance_records,
        forecast_request=request,
        programme_mappings={},
    )

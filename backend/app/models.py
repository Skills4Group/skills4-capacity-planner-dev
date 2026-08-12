from datetime import date, datetime
from enum import StrEnum

from pydantic import BaseModel, Field, model_validator


class Workstream(StrEnum):
    DENTAL = "Dental"
    PHARMACY = "Pharmacy"
    HOUSING = "Housing"
    SCIENCE = "Science"
    BUSINESS = "Business"
    OPERATIONS = "Operations"


class LearnerStatus(StrEnum):
    IN_PROGRESS = "In Progress"
    COMPLETED = "Completed"
    WITHDRAWN = "Withdrawn"
    PENDING = "Pending"
    ON_BREAK = "On Break"
    IN_END_POINT_ASSESSMENT = "In End Point Assessment"
    BREAK_RETURN_REQUESTED = "Break Return Requested"
    WITHDRAWAL_REQUESTED = "Withdrawal Requested"
    WITHDRAWAL_APPROVED = "Withdrawal Approved"
    BREAK_REQUESTED = "Break Requested"
    BREAK_APPROVED = "Break Approved"


CAPACITY_CONSUMING_STATUSES = frozenset(
    {
        LearnerStatus.IN_PROGRESS,
        LearnerStatus.IN_END_POINT_ASSESSMENT,
        LearnerStatus.WITHDRAWAL_REQUESTED,
        LearnerStatus.WITHDRAWAL_APPROVED,
        LearnerStatus.BREAK_REQUESTED,
    }
)


class Tutor(BaseModel):
    tutor_id: str
    tutor_name: str
    workstream: Workstream
    capacity: int = Field(default=50, ge=0, le=250)


class ExistingLearner(BaseModel):
    learner_id: str
    tutor_id: str
    programme_name: str
    start_date: date
    expected_end_date: date
    status: LearnerStatus

    @model_validator(mode="after")
    def validate_dates(self) -> "ExistingLearner":
        if self.expected_end_date < self.start_date:
            raise ValueError("expected_end_date must be on or after start_date")
        return self


class PipelineLearner(BaseModel):
    learner_id: str
    programme_name: str
    workstream: Workstream
    start_date: date
    expected_end_date: date

    @model_validator(mode="after")
    def validate_dates(self) -> "PipelineLearner":
        if self.expected_end_date < self.start_date:
            raise ValueError("expected_end_date must be on or after start_date")
        return self


class ForecastRequest(BaseModel):
    as_of_date: date
    months: int = Field(default=18, ge=1, le=36)
    tutors: list[Tutor]
    existing_learners: list[ExistingLearner]
    pipeline_learners: list[PipelineLearner]


class TutorMonth(BaseModel):
    month: date
    tutor_id: str
    tutor_name: str
    workstream: Workstream
    capacity: int
    opening_caseload: int
    existing_starts: int
    forecast_starts: int
    offboarded: int
    closing_caseload: int
    peak_caseload: int
    remaining_capacity: int
    utilisation_percent: float


class WorkstreamMonth(BaseModel):
    month: date
    workstream: Workstream
    tutors: int
    total_capacity: int
    opening_caseload: int
    forecast_starts: int
    offboarded: int
    peak_projected_caseload: int
    remaining_capacity: int
    utilisation_percent: float
    additional_tutors_required: int


class UnallocatedLearner(BaseModel):
    learner_id: str
    workstream: Workstream
    start_date: date
    expected_end_date: date


class ForecastResponse(BaseModel):
    generated_at: date
    months: list[date]
    tutor_months: list[TutorMonth]
    workstream_months: list[WorkstreamMonth]
    unallocated_learners: list[UnallocatedLearner]


class SessionResponse(BaseModel):
    authenticated: bool
    is_admin: bool
    display_name: str | None = None


class TutorAdminRecord(BaseModel):
    tutor_id: str
    tutor_name: str
    workstream: Workstream | None
    workstream_source: str
    capacity: int
    effective_capacity: int
    on_maternity_leave: bool
    current_caseload: int
    remaining_capacity: int
    has_saved_setting: bool
    updated_at: datetime | None = None
    updated_by: str | None = None


class TutorListResponse(BaseModel):
    as_of_date: date
    tutors: list[TutorAdminRecord]


class TutorUpdateRequest(BaseModel):
    capacity: int = Field(ge=0, le=250)
    workstream: Workstream
    on_maternity_leave: bool = False


class TutorUpdateResponse(BaseModel):
    tutor_id: str
    capacity: int
    workstream: Workstream
    on_maternity_leave: bool
    updated_by: str
    effective_from: date

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


REPORTING_WORKSTREAMS = tuple(
    workstream for workstream in Workstream if workstream != Workstream.OPERATIONS
)


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


class UnallocatedExistingLearner(BaseModel):
    learner_id: str
    programme_name: str
    workstream: Workstream
    start_date: date
    expected_end_date: date
    status: LearnerStatus

    @model_validator(mode="after")
    def validate_dates(self) -> "UnallocatedExistingLearner":
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
    unallocated_existing_learners: list[UnallocatedExistingLearner] = Field(
        default_factory=list
    )


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


class PredictiveWorkstreamMonth(BaseModel):
    month: date
    workstream: Workstream
    existing_active_learners: int
    known_pipeline_starts: int
    predicted_starts_p50: int
    predicted_starts_p80: int
    predicted_starts_p90: int
    predicted_active_p50: int
    predicted_active_p80: int
    predicted_active_p90: int
    effective_capacity: int
    additional_tutors_p50: int
    additional_tutors_p80: int
    additional_tutors_p90: int


class PredictiveWorkstreamSummary(BaseModel):
    workstream: Workstream
    historical_starts: int
    historical_months: int
    median_duration_months: int
    data_confidence: str
    current_active_learners: int
    effective_capacity: int
    peak_active_p50: int
    peak_active_p80: int
    peak_active_p90: int
    peak_additional_tutors_p50: int
    peak_additional_tutors_p80: int
    peak_additional_tutors_p90: int
    first_shortage_month_p50: date | None = None
    first_shortage_month_p80: date | None = None
    first_shortage_month_p90: date | None = None


class PredictiveForecastResponse(BaseModel):
    generated_at: date
    months: list[date]
    training_start: date
    training_end: date
    method_description: str
    data_warnings: list[str]
    workstream_months: list[PredictiveWorkstreamMonth]
    workstream_summaries: list[PredictiveWorkstreamSummary]


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
    is_active: bool = True
    status_updated_at: datetime | None = None
    status_updated_by: str | None = None
    is_new: bool = False
    first_seen_at: datetime | None = None
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    updated_at: datetime | None = None
    updated_by: str | None = None


class TutorListResponse(BaseModel):
    as_of_date: date
    tutors: list[TutorAdminRecord]
    new_tutor_count: int = 0


class TutorDiscoveryItem(BaseModel):
    tutor_id: str
    tutor_name: str
    first_seen_at: datetime


class TutorDiscoverySummary(BaseModel):
    checked_at: datetime
    new_tutor_count: int
    new_tutors: list[TutorDiscoveryItem]


class TutorAcknowledgementResponse(BaseModel):
    tutor_id: str
    acknowledged_at: datetime
    acknowledged_by: str


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


class TutorStatusUpdateRequest(BaseModel):
    is_active: bool


class TutorStatusUpdateResponse(BaseModel):
    tutor_id: str
    is_active: bool
    updated_by: str
    effective_from: date

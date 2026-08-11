export type Workstream = 'Dental' | 'Pharmacy' | 'Housing' | 'Science'

export interface TutorMonth {
  month: string
  tutor_id: string
  tutor_name: string
  workstream: Workstream
  capacity: number
  opening_caseload: number
  existing_starts: number
  forecast_starts: number
  offboarded: number
  closing_caseload: number
  peak_caseload: number
  remaining_capacity: number
  utilisation_percent: number
}

export interface WorkstreamMonth {
  month: string
  workstream: Workstream
  tutors: number
  total_capacity: number
  opening_caseload: number
  forecast_starts: number
  offboarded: number
  peak_projected_caseload: number
  remaining_capacity: number
  utilisation_percent: number
  additional_tutors_required: number
}

export interface ForecastResponse {
  generated_at: string
  months: string[]
  tutor_months: TutorMonth[]
  workstream_months: WorkstreamMonth[]
  unallocated_learners: Array<{
    learner_id: string
    workstream: Workstream
    start_date: string
    expected_end_date: string
  }>
}


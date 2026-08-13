export const workstreams = [
  'Dental',
  'Pharmacy',
  'Housing',
  'Science',
  'Business',
  'Operations',
] as const

export type Workstream = (typeof workstreams)[number]

export const reportingWorkstreams: Workstream[] = workstreams.filter(
  (workstream) => workstream !== 'Operations',
)

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

export interface TutorAdminRecord {
  tutor_id: string
  tutor_name: string
  workstream: Workstream | null
  workstream_source: 'saved' | 'inferred' | 'unassigned'
  capacity: number
  effective_capacity: number
  on_maternity_leave: boolean
  current_caseload: number
  remaining_capacity: number
  has_saved_setting: boolean
  updated_at: string | null
  updated_by: string | null
}

export interface TutorListResponse {
  as_of_date: string
  tutors: TutorAdminRecord[]
}

export interface SessionResponse {
  authenticated: boolean
  is_admin: boolean
  display_name: string | null
}

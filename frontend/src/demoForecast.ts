import { workstreams, type ForecastResponse, type Workstream } from './types'

const tutors: Array<[string, string, Workstream, number, number]> = [
  ['DEN-01', 'Amelia Hart', 'Dental', 50, 41],
  ['DEN-02', 'Imran Shah', 'Dental', 50, 38],
  ['DEN-03', 'Louise Bennett', 'Dental', 45, 36],
  ['PHA-01', 'Aisha Khan', 'Pharmacy', 50, 47],
  ['PHA-02', 'Marcus Reed', 'Pharmacy', 50, 43],
  ['PHA-03', 'Priya Nair', 'Pharmacy', 50, 39],
  ['PHA-04', 'Daniel Cole', 'Pharmacy', 45, 40],
  ['HOU-01', 'Carla Jones', 'Housing', 50, 42],
  ['HOU-02', 'Nathan Brooks', 'Housing', 45, 37],
  ['HOU-03', 'Megan Price', 'Housing', 50, 34],
  ['SCI-01', 'Sophie Turner', 'Science', 50, 44],
  ['SCI-02', 'Oliver Grant', 'Science', 50, 40],
  ['BUS-01', 'Hannah Wright', 'Business', 50, 37],
  ['BUS-02', 'George Patel', 'Business', 45, 34],
  ['OPS-01', 'Emma Collins', 'Operations', 50, 39],
  ['OPS-02', 'Ryan Walker', 'Operations', 50, 35],
]

function monthAt(index: number) {
  return new Date(Date.UTC(2026, 7 + index, 1)).toISOString().slice(0, 10)
}

export function createDemoForecast(): ForecastResponse {
  const months = Array.from({ length: 18 }, (_, index) => monthAt(index))
  const tutorMonths = months.flatMap((month, monthIndex) =>
    tutors.map(([id, name, workstream, capacity, startingLoad], tutorIndex) => {
      const forecastStarts = (monthIndex + tutorIndex * 2) % 5
      const offboarded = (monthIndex * 2 + tutorIndex) % 4
      const opening = Math.max(18, startingLoad + Math.floor(monthIndex * 0.45) - (tutorIndex % 3))
      const peak = Math.max(opening, opening + forecastStarts - Math.floor(offboarded / 2))
      return {
        month,
        tutor_id: id,
        tutor_name: name,
        workstream,
        capacity,
        opening_caseload: opening,
        existing_starts: 0,
        forecast_starts: forecastStarts,
        offboarded,
        closing_caseload: Math.max(0, opening + forecastStarts - offboarded),
        peak_caseload: peak,
        remaining_capacity: capacity - peak,
        utilisation_percent: Math.round((peak / capacity) * 1000) / 10,
      }
    }),
  )

  const workstreamMonths = months.flatMap((month) =>
    workstreams.map((workstream) => {
      const rows = tutorMonths.filter((row) => row.month === month && row.workstream === workstream)
      const totalCapacity = rows.reduce((sum, row) => sum + row.capacity, 0)
      const peak = rows.reduce((sum, row) => sum + row.peak_caseload, 0)
      const remaining = totalCapacity - peak
      return {
        month,
        workstream,
        tutors: rows.length,
        total_capacity: totalCapacity,
        opening_caseload: rows.reduce((sum, row) => sum + row.opening_caseload, 0),
        forecast_starts: rows.reduce((sum, row) => sum + row.forecast_starts, 0),
        offboarded: rows.reduce((sum, row) => sum + row.offboarded, 0),
        peak_projected_caseload: peak,
        remaining_capacity: remaining,
        utilisation_percent: Math.round((peak / totalCapacity) * 1000) / 10,
        additional_tutors_required: Math.ceil(Math.max(0, -remaining) / 50),
      }
    }),
  )

  return {
    generated_at: '2026-08-11',
    months,
    tutor_months: tutorMonths,
    workstream_months: workstreamMonths,
    unallocated_learners: [],
  }
}

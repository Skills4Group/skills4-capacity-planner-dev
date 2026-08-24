import type { WorkstreamMonth } from './types'

export type WorkstreamUtilisationTone = 'standard' | 'high' | 'over'

export interface WorkstreamUtilisationMetric {
  capacity: number
  learners: number
  remaining: number
  percent: number | null
  label: string
  tone: WorkstreamUtilisationTone
}

export function calculateWorkstreamUtilisation(
  rows: WorkstreamMonth[],
  scenarioCapacityPerTutor?: number,
): WorkstreamUtilisationMetric {
  const capacity = rows.reduce(
    (sum, row) => sum + (scenarioCapacityPerTutor === undefined
      ? row.total_capacity
      : row.tutors * scenarioCapacityPerTutor),
    0,
  )
  const learners = rows.reduce((sum, row) => sum + row.peak_projected_caseload, 0)
  const remaining = capacity - learners

  if (capacity <= 0 && learners > 0) {
    return { capacity, learners, remaining, percent: null, label: 'No capacity', tone: 'over' }
  }

  const percent = capacity > 0 ? Math.round((learners / capacity) * 1000) / 10 : 0
  const label = `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}% utilised`
  const tone = percent > 100 ? 'over' : percent >= 90 ? 'high' : 'standard'

  return { capacity, learners, remaining, percent, label, tone }
}

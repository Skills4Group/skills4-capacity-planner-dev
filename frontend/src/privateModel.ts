import { applyPredictiveScenario, predictedStartsAtConfidence, scenarioKey, type ScenarioDrafts } from './predictiveScenario.ts'
import type { CurrentCapacitySnapshot, ForecastResponse, PredictiveForecastResponse, PrivateModelAssumptions } from './types.ts'

const BASELINE_COHORT_SIZE = 50
const PHARMACY_LEVELS = ['pharmacy-l2', 'pharmacy-l3'] as const

export type PrivateModelScope = 'both' | (typeof PHARMACY_LEVELS)[number]

export function selectedPrivateModelProgrammes(scope: PrivateModelScope): readonly (typeof PHARMACY_LEVELS)[number][] {
  return scope === 'both' ? PHARMACY_LEVELS : [scope]
}

export function privateModelCurrentSnapshot(
  forecast: ForecastResponse,
  scope: PrivateModelScope,
): Pick<CurrentCapacitySnapshot, 'learners' | 'capacity' | 'remaining_places' | 'utilisation_percent'> | null {
  const snapshots = forecast.current_programme_snapshots
  const selected = selectedPrivateModelProgrammes(scope)
  if (!snapshots || !selected.every((code) => snapshots.some((row) => row.programme_code === code))) return null
  const rows = snapshots.filter((row) => selected.some((code) => code === row.programme_code))
  const learners = rows.reduce((total, row) => total + row.learners, 0)
  const capacity = rows.reduce((total, row) => total + row.capacity, 0)
  return {
    learners,
    capacity,
    remaining_places: capacity - learners,
    utilisation_percent: capacity > 0 ? Math.round(learners / capacity * 1000) / 10 : null,
  }
}

export interface PrivateModelMonth {
  month: string
  baselineStarts: number
  scenarioStarts: number
  baselineActive: number
  scenarioActive: number
  availableTutors: number
  baselineTutorsRequired: number
  scenarioTutorsRequired: number
  staffedTutors: number
  headcountChange: number
  additionalTutors: number
  potentialSurplus: number
  baselineCashIn: number | null
  scenarioCashIn: number | null
  baselinePayroll: number | null
  scenarioPayroll: number | null
  baselineMargin: number | null
  scenarioMargin: number | null
  cumulativeBaselineMargin: number | null
  cumulativeScenarioMargin: number | null
}

function money(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function buildPrivateModel(
  predictive: PredictiveForecastResponse,
  capacity: ForecastResponse,
  assumptions: PrivateModelAssumptions,
  scope: PrivateModelScope,
): PrivateModelMonth[] {
  const months = [...predictive.months].sort()
  const programmes = selectedPrivateModelProgrammes(scope)
  const programmeRows = new Map<string, ReturnType<typeof applyPredictiveScenario>>()

  for (const programmeCode of programmes) {
    const rows = predictive.programme_months.filter((row) => row.programme_code === programmeCode)
    const duration = predictive.programme_summaries.find((row) => row.programme_code === programmeCode)?.median_duration_months ?? 18
    const drafts: ScenarioDrafts = {}
    for (const row of rows) {
      if (row.month < assumptions.effective_month) continue
      const baselineStarts = predictedStartsAtConfidence(row, 'p80')
      drafts[scenarioKey(programmeCode, row.month)] = {
        starters: String(Math.round(baselineStarts * (1 - assumptions.enrolment_drop_percent / 100))),
      }
    }
    programmeRows.set(programmeCode, applyPredictiveScenario(rows, duration, 'p80', drafts, predictive.movement_rates))
  }

  let cumulativeBaseline = 0
  let cumulativeScenario = 0
  return months.map((month) => {
    let baselineStarts = 0
    let scenarioStarts = 0
    let baselineActive = 0
    let scenarioActive = 0
    let baselineTutorsRequired = 0
    let scenarioTutorsRequired = 0

    for (const programmeCode of programmes) {
      const row = programmeRows.get(programmeCode)?.find((item) => item.month === month)
      if (!row) continue
      baselineStarts += row.baselineStarts
      scenarioStarts += row.effectiveStarters
      baselineActive += row.baselineActive
      scenarioActive += row.revisedActive
      baselineTutorsRequired += Math.ceil(row.baselineActive / BASELINE_COHORT_SIZE)
      scenarioTutorsRequired += Math.ceil(row.revisedActive / assumptions.cohort_size)
    }

    const availableTutors = new Set(capacity.tutor_programme_months
      .filter((row) => row.month === month && row.capacity > 0 && programmes.some((code) => code === row.programme_code))
      .map((row) => row.tutor_id)).size
    const staffedTutors = assumptions.staffed_tutors ?? scenarioTutorsRequired
    const contract = assumptions.average_contract_value
    const tutorCost = assumptions.monthly_tutor_cost
    const baselineCashIn = contract === null ? null : money(baselineStarts * contract)
    const scenarioCashIn = contract === null ? null : money(scenarioStarts * contract)
    const baselinePayroll = tutorCost === null ? null : money(baselineTutorsRequired * tutorCost)
    const scenarioPayroll = tutorCost === null ? null : money(staffedTutors * tutorCost)
    const baselineMargin = baselineCashIn === null || baselinePayroll === null
      ? null : money(baselineCashIn - baselinePayroll)
    const scenarioMargin = scenarioCashIn === null || scenarioPayroll === null
      ? null : money(scenarioCashIn - scenarioPayroll)
    if (baselineMargin !== null) cumulativeBaseline = money(cumulativeBaseline + baselineMargin)
    if (scenarioMargin !== null) cumulativeScenario = money(cumulativeScenario + scenarioMargin)

    return {
      month, baselineStarts, scenarioStarts, baselineActive, scenarioActive,
      availableTutors, baselineTutorsRequired, scenarioTutorsRequired, staffedTutors,
      headcountChange: staffedTutors - availableTutors,
      additionalTutors: Math.max(0, scenarioTutorsRequired - staffedTutors),
      potentialSurplus: Math.max(0, staffedTutors - scenarioTutorsRequired),
      baselineCashIn, scenarioCashIn, baselinePayroll, scenarioPayroll,
      baselineMargin, scenarioMargin,
      cumulativeBaselineMargin: baselineMargin === null ? null : cumulativeBaseline,
      cumulativeScenarioMargin: scenarioMargin === null ? null : cumulativeScenario,
    }
  })
}

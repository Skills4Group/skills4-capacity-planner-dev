import { applyPredictiveScenario, predictedStartsAtConfidence, scenarioKey, type ScenarioDrafts } from './predictiveScenario.ts'
import { reportingWorkstreams, type ForecastResponse, type PredictiveForecastResponse, type PrivateModelAssumptions, type Workstream } from './types.ts'

const BASELINE_COHORT_SIZE = 50

export interface PrivateModelMonth {
  month: string
  baselineStarts: number
  scenarioStarts: number
  baselineActive: number
  scenarioActive: number
  availableTutors: number
  baselineTutorsRequired: number
  scenarioTutorsRequired: number
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
): PrivateModelMonth[] {
  const months = [...predictive.months].sort()
  const streamRows = new Map<Workstream, ReturnType<typeof applyPredictiveScenario>>()

  for (const workstream of reportingWorkstreams) {
    const rows = predictive.workstream_months.filter((row) => row.workstream === workstream)
    const duration = predictive.workstream_summaries.find((row) => row.workstream === workstream)?.median_duration_months ?? 18
    const drafts: ScenarioDrafts = {}
    for (const row of rows) {
      if (row.month < assumptions.effective_month) continue
      const baselineStarts = predictedStartsAtConfidence(row, 'p80')
      drafts[scenarioKey(workstream, row.month)] = {
        starters: String(Math.round(baselineStarts * (1 - assumptions.enrolment_drop_percent / 100))),
      }
    }
    streamRows.set(workstream, applyPredictiveScenario(rows, duration, 'p80', drafts, predictive.movement_rates))
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

    for (const workstream of reportingWorkstreams) {
      const row = streamRows.get(workstream)?.find((item) => item.month === month)
      if (!row) continue
      baselineStarts += row.baselineStarts
      scenarioStarts += row.effectiveStarters
      baselineActive += row.baselineActive
      scenarioActive += row.revisedActive
      baselineTutorsRequired += Math.ceil(row.baselineActive / BASELINE_COHORT_SIZE)
      scenarioTutorsRequired += Math.ceil(row.revisedActive / assumptions.cohort_size)
    }

    const availableTutors = new Set(capacity.tutor_months
      .filter((row) => row.month === month && row.capacity > 0 && row.workstream !== 'Operations')
      .map((row) => row.tutor_id)).size
    const contract = assumptions.average_contract_value
    const tutorCost = assumptions.monthly_tutor_cost
    const baselineCashIn = contract === null ? null : money(baselineStarts * contract)
    const scenarioCashIn = contract === null ? null : money(scenarioStarts * contract)
    const baselinePayroll = tutorCost === null ? null : money(baselineTutorsRequired * tutorCost)
    const scenarioPayroll = tutorCost === null ? null : money(scenarioTutorsRequired * tutorCost)
    const baselineMargin = baselineCashIn === null || baselinePayroll === null
      ? null : money(baselineCashIn - baselinePayroll)
    const scenarioMargin = scenarioCashIn === null || scenarioPayroll === null
      ? null : money(scenarioCashIn - scenarioPayroll)
    if (baselineMargin !== null) cumulativeBaseline = money(cumulativeBaseline + baselineMargin)
    if (scenarioMargin !== null) cumulativeScenario = money(cumulativeScenario + scenarioMargin)

    return {
      month, baselineStarts, scenarioStarts, baselineActive, scenarioActive,
      availableTutors, baselineTutorsRequired, scenarioTutorsRequired,
      additionalTutors: Math.max(0, scenarioTutorsRequired - availableTutors),
      potentialSurplus: Math.max(0, availableTutors - scenarioTutorsRequired),
      baselineCashIn, scenarioCashIn, baselinePayroll, scenarioPayroll,
      baselineMargin, scenarioMargin,
      cumulativeBaselineMargin: baselineMargin === null ? null : cumulativeBaseline,
      cumulativeScenarioMargin: scenarioMargin === null ? null : cumulativeScenario,
    }
  })
}

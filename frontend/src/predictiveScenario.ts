import type {
  PredictiveConfidence,
  PredictiveWorkstreamMonth,
  Workstream,
} from './types.ts'

export const NEW_TUTOR_CAPACITY = 50

export type ScenarioField =
  | 'starters'
  | 'bil'
  | 'bilReturns'
  | 'withdrawn'
  | 'outOfFunding'

export type ScenarioDraft = Partial<Record<ScenarioField, string>>
export type ScenarioDrafts = Record<string, ScenarioDraft>

export interface NormalisedScenarioInput {
  starters: number | null
  bil: number
  bilReturns: number
  withdrawn: number
  outOfFunding: number
}

export interface PredictiveScenarioRow {
  month: string
  workstream: Workstream
  baselineStarts: number
  effectiveStarters: number
  startersOverridden: boolean
  bil: number
  bilReturns: number
  withdrawn: number
  outOfFunding: number
  netMovement: number
  baselineActive: number
  revisedActive: number
  variance: number
  effectiveCapacity: number
  additionalTutors: number
  hasAdjustment: boolean
  invalidExitAmount: number
  bilReturnExceedsScenarioBreaks: boolean
}

export function scenarioKey(workstream: Workstream, month: string) {
  return `${workstream}:${month}`
}

function countValue(value: string | undefined) {
  if (!value) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.floor(parsed))
}

export function normaliseScenarioDraft(
  draft: ScenarioDraft | undefined,
): NormalisedScenarioInput {
  const startersValue = draft?.starters
  return {
    starters: startersValue === undefined || startersValue === ''
      ? null
      : countValue(startersValue),
    bil: countValue(draft?.bil),
    bilReturns: countValue(draft?.bilReturns),
    withdrawn: countValue(draft?.withdrawn),
    outOfFunding: countValue(draft?.outOfFunding),
  }
}

export function draftHasValues(draft: ScenarioDraft | undefined) {
  return Boolean(draft && Object.values(draft).some((value) => value !== ''))
}

export function predictedStartsAtConfidence(
  row: PredictiveWorkstreamMonth,
  confidence: PredictiveConfidence,
) {
  if (confidence === 'p50') return row.predicted_starts_p50
  if (confidence === 'p80') return row.predicted_starts_p80
  return row.predicted_starts_p90
}

export function predictedActiveAtConfidence(
  row: PredictiveWorkstreamMonth,
  confidence: PredictiveConfidence,
) {
  if (confidence === 'p50') return row.predicted_active_p50
  if (confidence === 'p80') return row.predicted_active_p80
  return row.predicted_active_p90
}

export function applyPredictiveScenario(
  rows: PredictiveWorkstreamMonth[],
  durationMonths: number,
  confidence: PredictiveConfidence,
  drafts: ScenarioDrafts,
): PredictiveScenarioRow[] {
  const ordered = [...rows].sort((left, right) => left.month.localeCompare(right.month))
  const starterAdjustments: number[] = []
  let cumulativeNonStarterMovement = 0
  let scenarioBreakBalance = 0

  return ordered.map((row, index) => {
    const draft = drafts[scenarioKey(row.workstream, row.month)]
    const input = normaliseScenarioDraft(draft)
    const baselineStarts = predictedStartsAtConfidence(row, confidence)
    const effectiveStarters = input.starters ?? baselineStarts
    const starterAdjustment = effectiveStarters - baselineStarts
    starterAdjustments.push(starterAdjustment)

    const activeStarterAdjustment = starterAdjustments.reduce(
      (total, adjustment, cohortIndex) => (
        index - cohortIndex < durationMonths ? total + adjustment : total
      ),
      0,
    )
    cumulativeNonStarterMovement += (
      input.bilReturns - input.bil - input.withdrawn - input.outOfFunding
    )
    scenarioBreakBalance += input.bil - input.bilReturns

    const baselineActive = predictedActiveAtConfidence(row, confidence)
    const rawRevisedActive = (
      baselineActive + activeStarterAdjustment + cumulativeNonStarterMovement
    )
    const revisedActive = Math.max(0, rawRevisedActive)
    const additionalTutors = Math.ceil(
      Math.max(0, revisedActive - row.effective_capacity) / NEW_TUTOR_CAPACITY,
    )

    return {
      month: row.month,
      workstream: row.workstream,
      baselineStarts,
      effectiveStarters,
      startersOverridden: input.starters !== null,
      bil: input.bil,
      bilReturns: input.bilReturns,
      withdrawn: input.withdrawn,
      outOfFunding: input.outOfFunding,
      netMovement: (
        effectiveStarters + input.bilReturns
        - input.bil - input.withdrawn - input.outOfFunding
      ),
      baselineActive,
      revisedActive,
      variance: revisedActive - baselineActive,
      effectiveCapacity: row.effective_capacity,
      additionalTutors,
      hasAdjustment: draftHasValues(draft),
      invalidExitAmount: Math.max(0, -rawRevisedActive),
      bilReturnExceedsScenarioBreaks: scenarioBreakBalance < 0,
    }
  })
}

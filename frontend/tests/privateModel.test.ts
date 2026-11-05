import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPrivateModel } from '../src/privateModel.ts'
import type { ForecastResponse, PredictiveForecastResponse, PredictiveWorkstreamMonth, PrivateModelAssumptions } from '../src/types.ts'

function forecastRow(month: string, starts: number, active: number): PredictiveWorkstreamMonth {
  return {
    month, workstream: 'Pharmacy', existing_active_learners: 0,
    scheduled_finishes: 0, known_pipeline_starts: 0,
    predicted_starts_p50: starts, predicted_starts_p80: starts, predicted_starts_p90: starts,
    predicted_active_p50: active, predicted_active_p80: active, predicted_active_p90: active,
    estimated_bil_p50: 0, estimated_bil_p80: 0, estimated_bil_p90: 0,
    estimated_oof_p50: 0, estimated_oof_p80: 0, estimated_oof_p90: 0,
    effective_capacity: 50, additional_tutors_p50: 0, additional_tutors_p80: 0,
    additional_tutors_p90: 0,
  }
}

const months = ['2026-11-01', '2026-12-01', '2027-01-01']
const predictive = {
  months,
  workstream_months: [
    forecastRow(months[0], 100, 92),
    forecastRow(months[1], 0, 92),
    forecastRow(months[2], 0, 0),
  ],
  workstream_summaries: [{ workstream: 'Pharmacy', median_duration_months: 2 }],
  movement_rates: months.map((month) => ({ month, bil_percent: 4, oof_percent: 4 })),
} as PredictiveForecastResponse
const capacity = {
  tutor_months: months.map((month) => ({ month, tutor_id: 'one', capacity: 50, workstream: 'Pharmacy' })),
} as ForecastResponse
const assumptions: PrivateModelAssumptions = {
  effective_month: months[0], cohort_size: 40, staffed_tutors: null,
  monthly_tutor_cost: 2000,
  average_contract_value: 1000, enrolment_drop_percent: 45,
  updated_at: null, updated_by: null,
}

test('45% start shock affects future cohort once, then expires', () => {
  const result = buildPrivateModel(predictive, capacity, assumptions)
  assert.deepEqual(result.map((row) => row.scenarioStarts), [55, 0, 0])
  assert.deepEqual(result.map((row) => row.scenarioActive), [51, 51, 0])
  assert.deepEqual(result.map((row) => row.scenarioTutorsRequired), [2, 2, 0])
  assert.equal(result[0].scenarioCashIn, 55_000)
  assert.equal(result[0].scenarioPayroll, 4_000)
  assert.equal(result[0].scenarioMargin, 51_000)
  assert.equal(result[1].cumulativeScenarioMargin, 47_000)
  assert.equal(result[2].cumulativeScenarioMargin, 47_000)
})

test('later effective month leaves earlier starters and cash untouched', () => {
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, effective_month: months[1] })
  assert.equal(result[0].scenarioStarts, 100)
  assert.equal(result[0].scenarioActive, 92)
  assert.equal(result[0].scenarioCashIn, 100_000)
})

test('unset financial levers do not display a zero margin', () => {
  const result = buildPrivateModel(predictive, capacity, {
    ...assumptions, monthly_tutor_cost: null, average_contract_value: null,
  })
  assert.equal(result[0].scenarioCashIn, null)
  assert.equal(result[0].scenarioPayroll, null)
  assert.equal(result[0].scenarioMargin, null)
})

test('fixed staffed tutor lever changes payroll and reveals uncovered demand', () => {
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, staffed_tutors: 1 })
  assert.equal(result[0].scenarioTutorsRequired, 2)
  assert.equal(result[0].staffedTutors, 1)
  assert.equal(result[0].additionalTutors, 1)
  assert.equal(result[0].scenarioPayroll, 2_000)
  assert.equal(result[0].scenarioCashIn, 55_000)
  assert.equal(result[0].scenarioMargin, 53_000)
  assert.equal(result[0].headcountChange, 0)
})

test('zero staffed tutors is a valid stress input, not auto staffing', () => {
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, staffed_tutors: 0 })
  assert.equal(result[0].staffedTutors, 0)
  assert.equal(result[0].scenarioPayroll, 0)
  assert.equal(result[0].additionalTutors, 2)
})

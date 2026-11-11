import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPrivateModel, privateModelCurrentSnapshot } from '../src/privateModel.ts'
import type { ForecastResponse, PredictiveForecastResponse, PredictiveProgrammeMonth, PredictiveWorkstreamMonth, PrivateModelAssumptions } from '../src/types.ts'

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
  programme_months: [
    ...months.map((month, index) => ({
      ...forecastRow(month, index === 0 ? 100 : 0, index === 2 ? 0 : 92),
      programme_code: 'pharmacy-l2', programme_name: 'Pharmacy L2',
    })),
    ...months.map((month) => ({
      ...forecastRow(month, 0, 0),
      programme_code: 'pharmacy-l3', programme_name: 'Pharmacy L3',
    })),
  ] as PredictiveProgrammeMonth[],
  programme_summaries: [
    { programme_code: 'pharmacy-l2', median_duration_months: 2 },
    { programme_code: 'pharmacy-l3', median_duration_months: 2 },
  ],
  movement_rates: months.map((month) => ({ month, bil_percent: 4, oof_percent: 4 })),
} as PredictiveForecastResponse
const capacity = {
  tutor_programme_months: months.flatMap((month) => [
    { month, tutor_id: 'one', capacity: 50, programme_code: 'pharmacy-l2' },
    { month, tutor_id: 'one', capacity: 10, programme_code: 'pharmacy-l3' },
    { month, tutor_id: 'other', capacity: 50, programme_code: 'technical-services' },
  ]),
} as ForecastResponse
const assumptions: PrivateModelAssumptions = {
  effective_month: months[0], cohort_size: 40, staffed_tutors: null,
  monthly_tutor_cost: 2000,
  average_contract_value: 1000, enrolment_drop_percent: 45,
  updated_at: null, updated_by: null,
}

test('45% start shock affects future cohort once, then expires', () => {
  const result = buildPrivateModel(predictive, capacity, assumptions, 'both')
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
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, effective_month: months[1] }, 'both')
  assert.equal(result[0].scenarioStarts, 100)
  assert.equal(result[0].scenarioActive, 92)
  assert.equal(result[0].scenarioCashIn, 100_000)
})

test('unset financial levers do not display a zero margin', () => {
  const result = buildPrivateModel(predictive, capacity, {
    ...assumptions, monthly_tutor_cost: null, average_contract_value: null,
  }, 'both')
  assert.equal(result[0].scenarioCashIn, null)
  assert.equal(result[0].scenarioPayroll, null)
  assert.equal(result[0].scenarioMargin, null)
})

test('fixed staffed tutor lever changes payroll and reveals uncovered demand', () => {
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, staffed_tutors: 1 }, 'both')
  assert.equal(result[0].scenarioTutorsRequired, 2)
  assert.equal(result[0].staffedTutors, 1)
  assert.equal(result[0].additionalTutors, 1)
  assert.equal(result[0].scenarioPayroll, 2_000)
  assert.equal(result[0].scenarioCashIn, 55_000)
  assert.equal(result[0].scenarioMargin, 53_000)
  assert.equal(result[0].headcountChange, 0)
})

test('zero staffed tutors is a valid stress input, not auto staffing', () => {
  const result = buildPrivateModel(predictive, capacity, { ...assumptions, staffed_tutors: 0 }, 'both')
  assert.equal(result[0].staffedTutors, 0)
  assert.equal(result[0].scenarioPayroll, 0)
  assert.equal(result[0].additionalTutors, 2)
})

test('L2, L3 and both scopes use only their selected programme demand and distinct tutors', () => {
  const nextPredictive = {
    ...predictive,
    programme_months: [
      ...predictive.programme_months,
      { ...forecastRow(months[0], 20, 18), programme_code: 'pharmacy-l3', programme_name: 'Pharmacy L3' },
      { ...forecastRow(months[0], 500, 460), programme_code: 'technical-services', programme_name: 'Technical Services' },
    ].filter((row) => !(row.programme_code === 'pharmacy-l3' && row.month === months[0] && row.predicted_starts_p80 === 0)),
  } as PredictiveForecastResponse
  const l2 = buildPrivateModel(nextPredictive, capacity, assumptions, 'pharmacy-l2')[0]
  const l3 = buildPrivateModel(nextPredictive, capacity, assumptions, 'pharmacy-l3')[0]
  const both = buildPrivateModel(nextPredictive, capacity, assumptions, 'both')[0]

  assert.equal(l2.scenarioStarts, 55)
  assert.equal(l2.scenarioTutorsRequired, 2)
  assert.equal(l3.scenarioStarts, 11)
  assert.equal(l3.scenarioTutorsRequired, 1)
  assert.equal(both.scenarioStarts, 66)
  assert.equal(both.scenarioTutorsRequired, 3)
  assert.equal(both.availableTutors, 1)
  assert.equal(both.scenarioCashIn, 66_000)
})

test('current snapshot sums L2 and L3 only, not unclassified Pharmacy', () => {
  const withSnapshots = {
    ...capacity,
    current_programme_snapshots: [
      { programme_code: 'pharmacy-l2', learners: 50, capacity: 60, tutors: 2, remaining_places: 10, utilisation_percent: 83.3, workstream: 'Pharmacy' },
      { programme_code: 'pharmacy-l3', learners: 30, capacity: 40, tutors: 1, remaining_places: 10, utilisation_percent: 75, workstream: 'Pharmacy' },
      { programme_code: 'pharmacy-general', learners: 10, capacity: 0, tutors: 0, remaining_places: -10, utilisation_percent: null, workstream: 'Pharmacy' },
    ],
  } as ForecastResponse
  assert.equal(privateModelCurrentSnapshot(withSnapshots, 'pharmacy-l2')?.learners, 50)
  assert.equal(privateModelCurrentSnapshot(withSnapshots, 'pharmacy-l3')?.learners, 30)
  assert.deepEqual(privateModelCurrentSnapshot(withSnapshots, 'both'), {
    learners: 80, capacity: 100, remaining_places: 20, utilisation_percent: 80,
  })
})

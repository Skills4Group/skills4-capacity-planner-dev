import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyPredictiveScenario,
  scenarioKey,
  type ScenarioDrafts,
} from '../src/predictiveScenario.ts'
import { reportingWorkstreams, type PredictiveWorkstreamMonth } from '../src/types.ts'

function row(
  month: string,
  active = 40,
  starts = 10,
  capacity = 50,
): PredictiveWorkstreamMonth {
  return {
    month,
    workstream: 'Pharmacy',
    existing_active_learners: active,
    known_pipeline_starts: 0,
    predicted_starts_p50: starts,
    predicted_starts_p80: starts,
    predicted_starts_p90: starts,
    predicted_active_p50: active,
    predicted_active_p80: active,
    predicted_active_p90: active,
    effective_capacity: capacity,
    additional_tutors_p50: 0,
    additional_tutors_p80: 0,
    additional_tutors_p90: 0,
  }
}

test('an empty scenario exactly reproduces the selected model baseline', () => {
  const result = applyPredictiveScenario(
    [row('2026-09-01'), row('2026-10-01', 45)],
    18,
    'p80',
    {},
  )

  assert.deepEqual(result.map((item) => item.revisedActive), [40, 45])
  assert.deepEqual(result.map((item) => item.effectiveStarters), [10, 10])
  assert.ok(result.every((item) => !item.hasAdjustment))
})

test('zero starters is an explicit override and expires after programme duration', () => {
  const drafts: ScenarioDrafts = {
    [scenarioKey('Pharmacy', '2026-09-01')]: { starters: '0' },
  }
  const result = applyPredictiveScenario(
    [
      row('2026-09-01', 40),
      row('2026-10-01', 50),
      row('2026-11-01', 60),
    ],
    2,
    'p80',
    drafts,
  )

  assert.equal(result[0].startersOverridden, true)
  assert.deepEqual(result.map((item) => item.revisedActive), [30, 40, 60])
})

test('BiL, withdrawals and OOF reduce demand until offset by a BiL return', () => {
  const drafts: ScenarioDrafts = {
    [scenarioKey('Pharmacy', '2026-09-01')]: {
      bil: '2',
      withdrawn: '3',
      outOfFunding: '1',
    },
    [scenarioKey('Pharmacy', '2026-10-01')]: { bilReturns: '2' },
  }
  const result = applyPredictiveScenario(
    [row('2026-09-01'), row('2026-10-01')],
    18,
    'p80',
    drafts,
  )

  assert.deepEqual(result.map((item) => item.revisedActive), [34, 36])
  assert.equal(result[0].netMovement, 4)
  assert.equal(result[1].netMovement, 12)
})

test('an excessive exit is visible, capped at zero, and never produces negative demand', () => {
  const drafts: ScenarioDrafts = {
    [scenarioKey('Pharmacy', '2026-09-01')]: { withdrawn: '10' },
  }
  const [result] = applyPredictiveScenario(
    [row('2026-09-01', 5)],
    18,
    'p80',
    drafts,
  )

  assert.equal(result.revisedActive, 0)
  assert.equal(result.invalidExitAmount, 5)
})

test('additional tutors use 50 places and round shortages upward', () => {
  const [result] = applyPredictiveScenario(
    [row('2026-09-01', 121, 10, 50)],
    18,
    'p80',
    {},
  )

  assert.equal(result.additionalTutors, 2)
})

test('Operations is not a reporting workstream', () => {
  assert.equal(reportingWorkstreams.includes('Operations'), false)
})

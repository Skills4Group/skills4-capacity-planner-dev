import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateWorkstreamUtilisation } from '../src/workstreamUtilisation.ts'
import type { WorkstreamMonth } from '../src/types.ts'

function row(overrides: Partial<WorkstreamMonth> = {}): WorkstreamMonth {
  return {
    month: '2026-08-01',
    workstream: 'Pharmacy',
    tutors: 2,
    total_capacity: 100,
    opening_caseload: 0,
    forecast_starts: 0,
    offboarded: 0,
    peak_projected_caseload: 80,
    remaining_capacity: 20,
    utilisation_percent: 80,
    additional_tutors_required: 0,
    ...overrides,
  }
}

test('calculates workstream utilisation from projected learners and capacity', () => {
  assert.deepEqual(calculateWorkstreamUtilisation([row()]), {
    capacity: 100,
    learners: 80,
    remaining: 20,
    percent: 80,
    label: '80% utilised',
    tone: 'standard',
  })
})

test('all-workstream utilisation is capacity weighted', () => {
  const metric = calculateWorkstreamUtilisation([
    row(),
    row({ workstream: 'Dental', tutors: 1, total_capacity: 50, peak_projected_caseload: 30 }),
  ])

  assert.equal(metric.capacity, 150)
  assert.equal(metric.learners, 110)
  assert.equal(metric.percent, 73.3)
})

test('scenario capacity updates workstream utilisation by tutor count', () => {
  const metric = calculateWorkstreamUtilisation([
    row({ tutors: 3, total_capacity: 125, peak_projected_caseload: 108 }),
  ], 40)

  assert.equal(metric.capacity, 120)
  assert.equal(metric.remaining, 12)
  assert.equal(metric.label, '90% utilised')
  assert.equal(metric.tone, 'high')
})

test('demand without capacity is shown as a shortage, not zero percent utilisation', () => {
  assert.deepEqual(
    calculateWorkstreamUtilisation([row({ tutors: 0, total_capacity: 0, peak_projected_caseload: 12 })]),
    { capacity: 0, learners: 12, remaining: -12, percent: null, label: 'No capacity', tone: 'over' },
  )
})

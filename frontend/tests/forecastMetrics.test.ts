import test from 'node:test'
import assert from 'node:assert/strict'

import { distinctAvailableTutors, modelAggregateCapacity, modelTutorCapacity } from '../src/forecastMetrics.ts'
import type { TutorMonth, WorkstreamMonth } from '../src/types.ts'

function tutor(tutor_id: string, workstream: TutorMonth['workstream'], capacity: number): TutorMonth {
  return {
    month: '2026-10-01', tutor_id, tutor_name: tutor_id, workstream, capacity,
    active_cohorts: 0, opening_caseload: 0, existing_starts: 0, forecast_starts: 0,
    offboarded: 0, closing_caseload: 0, peak_caseload: 0,
    remaining_capacity: capacity, utilisation_percent: 0,
  }
}

function aggregate(workstream: WorkstreamMonth['workstream'], total_capacity: number): WorkstreamMonth {
  return {
    month: '2026-10-01', workstream, tutors: 1, total_capacity,
    opening_caseload: 0, forecast_starts: 0, offboarded: 0,
    peak_projected_caseload: 10, remaining_capacity: total_capacity - 10,
    utilisation_percent: 0, additional_tutors_required: 0,
  }
}

test('multi-workstream tutor is one staff member', () => {
  const rows = [tutor('T1', 'Pharmacy', 30), tutor('T1', 'Dental', 20)]
  assert.equal(distinctAvailableTutors(rows), 1)
})

test('scenario preserves zero capacity and distributes one tutor maximum across workstreams', () => {
  const modeled = modelTutorCapacity([
    tutor('T1', 'Pharmacy', 30), tutor('T1', 'Dental', 20),
    tutor('T2', 'Pharmacy', 0),
  ], 40)
  assert.deepEqual(modeled.map((row) => row.capacity), [24, 16, 0])
  assert.equal(distinctAvailableTutors(modeled), 1)
  const aggregateRows = modelAggregateCapacity([
    aggregate('Pharmacy', 30), aggregate('Dental', 20),
  ], modeled)
  assert.deepEqual(aggregateRows.map((row) => row.total_capacity), [24, 16])
})

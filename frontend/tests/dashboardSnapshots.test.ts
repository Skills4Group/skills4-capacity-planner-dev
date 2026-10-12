import assert from 'node:assert/strict'
import test from 'node:test'

import { selectCurrentSnapshot, currentUtilisationLabel } from '../src/dashboardSnapshots.ts'
import type { ForecastResponse } from '../src/types.ts'

test('selects today snapshot independently of the selected forecast month', () => {
  const forecast = {
    generated_at: '2026-10-12', months: ['2026-10-01', '2026-11-01'],
    tutor_months: [], workstream_months: [],
    tutor_programme_months: [], programme_months: [], unallocated_learners: [],
    current_total_snapshot: {
      learners: 80, capacity: 100, tutors: 2,
      remaining_places: 20, utilisation_percent: 80,
    },
    current_workstream_snapshots: [{
      workstream: 'Pharmacy', learners: 30, capacity: 50, tutors: 1,
      remaining_places: 20, utilisation_percent: 60,
    }],
    current_programme_snapshots: [{
      workstream: 'Pharmacy', programme_code: 'pharmacy-l3',
      learners: 20, capacity: 25, tutors: 1,
      remaining_places: 5, utilisation_percent: 80,
    }],
  } satisfies ForecastResponse

  assert.equal(selectCurrentSnapshot(forecast, 'All')?.learners, 80)
  assert.equal(selectCurrentSnapshot(forecast, 'Pharmacy')?.learners, 30)
  assert.equal(selectCurrentSnapshot(forecast, 'pharmacy-l3')?.learners, 20)
  assert.equal(selectCurrentSnapshot(forecast, 'pharmacy-general'), undefined)
})

test('zero capacity is not presented as zero percent utilisation', () => {
  assert.equal(currentUtilisationLabel({
    learners: 3, capacity: 0, tutors: 0,
    remaining_places: -3, utilisation_percent: null,
  }), 'No capacity')
})

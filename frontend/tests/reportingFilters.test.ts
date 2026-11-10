import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dashboardFilterOptions,
  isProgrammeFilter,
  reportingFilterLabels,
  reportingFilterOptions,
  workstreamForFilter,
} from '../src/reportingFilters.ts'

test('keeps broad Pharmacy and exposes only level-specific Pharmacy filters', () => {
  assert.ok(reportingFilterOptions.includes('Pharmacy'))
  assert.ok(!reportingFilterOptions.map(String).includes('pharmacy-general'))
  assert.ok(reportingFilterOptions.includes('pharmacy-l2'))
  assert.ok(reportingFilterOptions.includes('pharmacy-l3'))
  assert.equal(reportingFilterLabels.Pharmacy, 'Pharmacy (all)')
})

test('dashboard and other reports use the same Pharmacy filter choices', () => {
  assert.deepEqual(dashboardFilterOptions, reportingFilterOptions)
  assert.ok(dashboardFilterOptions.includes('Pharmacy'))
  assert.ok(dashboardFilterOptions.includes('pharmacy-l2'))
  assert.ok(dashboardFilterOptions.includes('pharmacy-l3'))
  assert.ok(!reportingFilterOptions.map(String).includes('pharmacy-general'))
})

test('maps programme filters back to the Pharmacy workstream', () => {
  for (const programme of ['pharmacy-l2', 'pharmacy-l3'] as const) {
    assert.equal(isProgrammeFilter(programme), true)
    assert.equal(workstreamForFilter(programme), 'Pharmacy')
  }
})

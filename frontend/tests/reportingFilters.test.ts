import assert from 'node:assert/strict'
import test from 'node:test'

import {
  dashboardFilterOptions,
  isProgrammeFilter,
  reportingFilterLabels,
  reportingFilterOptions,
  workstreamForFilter,
} from '../src/reportingFilters.ts'

test('keeps broad Pharmacy and exposes all three Pharmacy programme filters', () => {
  assert.ok(reportingFilterOptions.includes('Pharmacy'))
  assert.ok(reportingFilterOptions.includes('pharmacy-general'))
  assert.ok(reportingFilterOptions.includes('pharmacy-l2'))
  assert.ok(reportingFilterOptions.includes('pharmacy-l3'))
  assert.equal(reportingFilterLabels.Pharmacy, 'Pharmacy (all)')
})

test('dashboard omits Pharmacy general without removing the filter elsewhere', () => {
  assert.ok(!dashboardFilterOptions.includes('pharmacy-general'))
  assert.ok(dashboardFilterOptions.includes('Pharmacy'))
  assert.ok(dashboardFilterOptions.includes('pharmacy-l2'))
  assert.ok(dashboardFilterOptions.includes('pharmacy-l3'))
  assert.ok(reportingFilterOptions.includes('pharmacy-general'))
})

test('maps programme filters back to the Pharmacy workstream', () => {
  for (const programme of ['pharmacy-general', 'pharmacy-l2', 'pharmacy-l3'] as const) {
    assert.equal(isProgrammeFilter(programme), true)
    assert.equal(workstreamForFilter(programme), 'Pharmacy')
  }
})

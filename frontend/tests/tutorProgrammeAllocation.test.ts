import test from 'node:test'
import assert from 'node:assert/strict'

import {
  effectiveTutorProgrammeAllocations,
  tutorMatchesProgramme,
} from '../src/tutorProgrammeAllocation.ts'
import type { ProgrammePlanningRecord, TutorAdminRecord } from '../src/types.ts'

const programmes: ProgrammePlanningRecord[] = [
  {
    programme_code: 'pharmacy-general',
    display_name: 'Pharmacy (general)',
    workstream: 'Pharmacy',
    level: null,
    duration_months: 18,
    active: true,
  },
  {
    programme_code: 'pharmacy-l2',
    display_name: 'Pharmacy L2',
    workstream: 'Pharmacy',
    level: 'L2',
    duration_months: 15,
    active: true,
  },
]

function tutor(overrides: Partial<TutorAdminRecord> = {}): TutorAdminRecord {
  return {
    tutor_id: 'attendance-tutor-1',
    tutor_name: 'Chelsea Gilbert',
    workstream: 'Pharmacy',
    workstream_source: 'inferred',
    capacity: 55,
    effective_capacity: 55,
    on_maternity_leave: false,
    maternity_return_date: null,
    delivery_eligible: true,
    programme_allocations: [],
    current_caseload: 48,
    active_cohorts: 3,
    remaining_capacity: 7,
    has_saved_setting: false,
    is_active: true,
    status_updated_at: null,
    status_updated_by: null,
    is_new: false,
    first_seen_at: null,
    acknowledged_at: null,
    acknowledged_by: null,
    updated_at: null,
    updated_by: null,
    ...overrides,
  }
}

test('uses the generic programme shown in the editor when no allocation is persisted', () => {
  assert.deepEqual(effectiveTutorProgrammeAllocations(tutor(), programmes), [
    { programmeCode: 'pharmacy-general', capacity: '55' },
  ])
  assert.equal(tutorMatchesProgramme(tutor(), programmes, 'pharmacy-general'), true)
})

test('uses persisted programme allocations instead of the workstream fallback', () => {
  const pharmacyL2Tutor = tutor({
    programme_allocations: [{
      programme_code: 'pharmacy-l2',
      programme_name: 'Pharmacy L2',
      workstream: 'Pharmacy',
      capacity: 55,
    }],
  })

  assert.equal(tutorMatchesProgramme(pharmacyL2Tutor, programmes, 'pharmacy-l2'), true)
  assert.equal(tutorMatchesProgramme(pharmacyL2Tutor, programmes, 'pharmacy-general'), false)
})

test('does not fabricate a programme for an unassigned tutor', () => {
  const unassignedTutor = tutor({ workstream: null })

  assert.deepEqual(effectiveTutorProgrammeAllocations(unassignedTutor, programmes), [])
  assert.equal(tutorMatchesProgramme(unassignedTutor, programmes, 'pharmacy-general'), false)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { buildTutorDirectoryCsv, type TutorDirectoryCsvRow } from '../src/tutorDirectoryCsv.ts'

function row(change: Partial<TutorDirectoryCsvRow> = {}): TutorDirectoryCsvRow {
  return {
    tutorName: 'Aisha Khan',
    tutorId: 'T-001',
    teachingAllocations: 'Pharmacy L2 (20 places); Pharmacy L3 (30 places)',
    currentLearners: 42,
    activeCohorts: 3,
    maximumCapacity: 50,
    deliveryRole: 'Delivery',
    maternityLeave: 'Available',
    returnMonth: '',
    tutorStatus: 'Active',
    remaining: 8,
    utilisation: '84%',
    configuration: 'Configured',
    ...change,
  }
}

test('exports the tutor directory with Excel-compatible headings and values', () => {
  const csv = buildTutorDirectoryCsv([row()])

  assert.ok(csv.startsWith('\uFEFF"Tutor","Tutor ID","Teaching allocations"'))
  assert.match(csv, /"Aisha Khan","T-001"/)
  assert.match(csv, /"Pharmacy L2 \(20 places\); Pharmacy L3 \(30 places\)"/)
  assert.match(csv, /"42","3","50"/)
  assert.ok(csv.endsWith('\r\n'))
})

test('escapes quotes and neutralises spreadsheet formulas in text fields', () => {
  const csv = buildTutorDirectoryCsv([
    row({ tutorName: '=HYPERLINK("unsafe")', tutorId: 'T,"002"' }),
  ])

  assert.match(csv, /"'=HYPERLINK\(""unsafe""\)"/)
  assert.match(csv, /"T,""002"""/)
})

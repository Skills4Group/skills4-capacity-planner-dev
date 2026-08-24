import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateTutorUtilisation } from '../src/tutorUtilisation.ts'

test('calculates tutor utilisation to one decimal place', () => {
  assert.deepEqual(
    calculateTutorUtilisation({ currentLearners: 40, capacity: 45, isActive: true, onMaternityLeave: false }),
    { label: '88.9%', percent: 88.9, tone: 'standard' },
  )
})

test('shows whole percentages without a decimal and flags high utilisation', () => {
  assert.deepEqual(
    calculateTutorUtilisation({ currentLearners: 46, capacity: 50, isActive: true, onMaternityLeave: false }),
    { label: '92%', percent: 92, tone: 'high' },
  )
})

test('allows over-capacity utilisation to exceed 100 percent', () => {
  assert.deepEqual(
    calculateTutorUtilisation({ currentLearners: 55, capacity: 50, isActive: true, onMaternityLeave: false }),
    { label: '110%', percent: 110, tone: 'over' },
  )
})

test('zero capacity and maternity leave are unavailable', () => {
  assert.equal(calculateTutorUtilisation({ currentLearners: 0, capacity: 0, isActive: true, onMaternityLeave: false }).label, 'Unavailable')
  assert.equal(calculateTutorUtilisation({ currentLearners: 40, capacity: 50, isActive: true, onMaternityLeave: true }).label, 'Unavailable')
})

test('inactive tutors are excluded regardless of capacity', () => {
  assert.deepEqual(
    calculateTutorUtilisation({ currentLearners: 40, capacity: 50, isActive: false, onMaternityLeave: false }),
    { label: 'Excluded', percent: null, tone: 'excluded' },
  )
})

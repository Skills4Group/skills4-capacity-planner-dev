import test from 'node:test'
import assert from 'node:assert/strict'

import { defaultForecastMonth, selectMonthOptions, selectRollingMonths } from '../src/rollingMonths.ts'

const months = [
  '2026-06-01',
  '2026-07-01',
  '2026-08-01',
  '2026-09-01',
  '2026-10-01',
  '2026-11-01',
  '2026-12-01',
  '2027-01-01',
  '2027-02-01',
  '2027-03-01',
]

test('six-month horizon starts from the current calendar month', () => {
  assert.deepEqual(
    selectRollingMonths(months, 6, new Date(2026, 8, 15)),
    ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01'],
  )
})

test('past months are removed before applying a longer horizon', () => {
  assert.deepEqual(
    selectRollingMonths(months, 12, new Date(2026, 9, 1)),
    ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01'],
  )
})

test('future forecast months are retained when no past month is present', () => {
  assert.deepEqual(
    selectRollingMonths(['2026-10-01', '2026-11-01'], 6, new Date(2026, 8, 30)),
    ['2026-10-01', '2026-11-01'],
  )
})

test('month options include no more than the three preceding calendar months', () => {
  assert.deepEqual(
    selectMonthOptions(months, 3, new Date(2026, 8, 3)),
    months,
  )
  assert.deepEqual(
    selectMonthOptions(['2026-05-01', ...months], 3, new Date(2026, 8, 3)),
    months,
  )
})

test('the current month is the default even when prior months are available', () => {
  assert.equal(defaultForecastMonth(months, new Date(2026, 8, 3)), '2026-09-01')
})

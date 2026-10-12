import type { TutorMonth, WorkstreamMonth } from './types'

type ScopeRow = TutorMonth & { programme_code?: string }
type AggregateRow = WorkstreamMonth & { programme_code?: string }

function scopeFor(row: ScopeRow | AggregateRow): string {
  return row.programme_code ?? row.workstream
}

export function distinctAvailableTutors(rows: ScopeRow[]): number {
  return new Set(rows.filter((row) => row.capacity > 0).map((row) => row.tutor_id)).size
}

export function modelTutorCapacity<T extends ScopeRow>(rows: T[], maximum: number): T[] {
  const modeledMaximum = Number.isFinite(maximum) ? Math.max(0, Math.floor(maximum)) : 0
  const byTutor = new Map<string, T[]>()
  for (const row of rows) {
    const group = byTutor.get(row.tutor_id) ?? []
    group.push(row)
    byTutor.set(row.tutor_id, group)
  }
  const modeledCapacity = new Map<T, number>()
  for (const group of byTutor.values()) {
    const available = group.filter((row) => row.capacity > 0)
    const total = available.reduce((sum, row) => sum + row.capacity, 0)
    if (!total) continue
    const allocations = available.map((row) => {
      const exact = row.capacity / total * modeledMaximum
      return { row, capacity: Math.floor(exact), fraction: exact % 1 }
    })
    let remaining = modeledMaximum - allocations.reduce((sum, item) => sum + item.capacity, 0)
    allocations.sort((a, b) => b.fraction - a.fraction || scopeFor(a.row).localeCompare(scopeFor(b.row)))
    for (const item of allocations) {
      if (remaining > 0) {
        item.capacity += 1
        remaining -= 1
      }
      modeledCapacity.set(item.row, item.capacity)
    }
  }
  return rows.map((row) => {
    const capacity = modeledCapacity.get(row) ?? 0
    return {
      ...row,
      capacity,
      remaining_capacity: capacity - row.peak_caseload,
      utilisation_percent: capacity > 0
        ? Math.round(row.peak_caseload / capacity * 1000) / 10
        : 0,
    }
  })
}

export function modelAggregateCapacity<T extends AggregateRow>(
  rows: T[], tutorRows: ScopeRow[], newTutorCapacity = 50,
): T[] {
  const capacities = new Map<string, number>()
  for (const row of tutorRows) {
    const scope = scopeFor(row)
    capacities.set(scope, (capacities.get(scope) ?? 0) + row.capacity)
  }
  return rows.map((row) => {
    const capacity = capacities.get(scopeFor(row)) ?? 0
    return {
      ...row,
      total_capacity: capacity,
      remaining_capacity: capacity - row.peak_projected_caseload,
      utilisation_percent: capacity > 0
        ? Math.round(row.peak_projected_caseload / capacity * 1000) / 10
        : 0,
      additional_tutors_required: Math.ceil(
        Math.max(0, row.peak_projected_caseload - capacity) / Math.max(1, newTutorCapacity),
      ),
    }
  })
}

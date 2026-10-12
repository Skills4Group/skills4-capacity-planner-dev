import type { CurrentCapacitySnapshot, ForecastResponse } from './types'
import { isProgrammeFilter, type ReportingFilter } from './reportingFilters.ts'

export function selectCurrentSnapshot(
  forecast: ForecastResponse,
  filter: ReportingFilter,
): CurrentCapacitySnapshot | undefined {
  if (filter === 'All') return forecast.current_total_snapshot ?? undefined
  if (isProgrammeFilter(filter)) {
    return forecast.current_programme_snapshots?.find((row) => row.programme_code === filter)
  }
  return forecast.current_workstream_snapshots?.find((row) => row.workstream === filter)
}

export function currentUtilisationLabel(snapshot: CurrentCapacitySnapshot | undefined): string {
  if (!snapshot) return 'Unavailable'
  if (snapshot.capacity <= 0) return 'No capacity'
  return `${snapshot.utilisation_percent ?? 0}% utilised`
}

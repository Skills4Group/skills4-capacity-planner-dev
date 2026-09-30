import type { Workstream } from './types.ts'

export const pharmacyProgrammeFilters = [
  'pharmacy-general',
  'pharmacy-l2',
  'pharmacy-l3',
] as const

export type PharmacyProgrammeFilter = (typeof pharmacyProgrammeFilters)[number]
export type ReportingFilter = 'All' | Workstream | PharmacyProgrammeFilter
export type ReportingScope = Exclude<ReportingFilter, 'All'>

export const reportingFilterLabels: Record<ReportingFilter, string> = {
  All: 'All workstreams',
  Dental: 'Dental',
  Pharmacy: 'Pharmacy (all)',
  'pharmacy-general': 'Pharmacy (general)',
  'pharmacy-l2': 'Pharmacy L2',
  'pharmacy-l3': 'Pharmacy L3',
  Housing: 'Housing',
  Science: 'Science',
  Business: 'Business',
  Operations: 'Operations',
}

export const reportingFilterOptions: ReportingFilter[] = [
  'All',
  'Dental',
  'Pharmacy',
  ...pharmacyProgrammeFilters,
  'Housing',
  'Science',
  'Business',
]

export const reportingScopeOptions = reportingFilterOptions.filter(
  (filter): filter is ReportingScope => filter !== 'All',
)

export function isProgrammeFilter(
  filter: ReportingFilter,
): filter is PharmacyProgrammeFilter {
  return pharmacyProgrammeFilters.includes(filter as PharmacyProgrammeFilter)
}

export function workstreamForFilter(filter: ReportingFilter): Workstream | null {
  if (filter === 'All') return null
  if (isProgrammeFilter(filter)) return 'Pharmacy'
  return filter
}

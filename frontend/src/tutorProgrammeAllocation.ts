import type { ProgrammePlanningRecord, TutorAdminRecord } from './types'

export interface EffectiveTutorProgrammeAllocation {
  programmeCode: string
  capacity: string
}

export function effectiveTutorProgrammeAllocations(
  tutor: TutorAdminRecord,
  programmes: ProgrammePlanningRecord[],
): EffectiveTutorProgrammeAllocation[] {
  if (tutor.programme_allocations.length) {
    return tutor.programme_allocations.map((allocation) => ({
      programmeCode: allocation.programme_code,
      capacity: String(allocation.capacity),
    }))
  }

  // Pharmacy has two distinct levels; an inferred workstream is not enough
  // evidence to allocate this tutor's capacity to either one.
  if (tutor.workstream === 'Pharmacy') return []

  const generic = programmes.find((programme) => (
    programme.active
    && programme.workstream === tutor.workstream
    && programme.programme_code.endsWith('-general')
  )) ?? programmes.find((programme) => (
    programme.active && programme.workstream === tutor.workstream
  ))

  return generic
    ? [{ programmeCode: generic.programme_code, capacity: String(tutor.capacity) }]
    : []
}

export function tutorMatchesProgramme(
  tutor: TutorAdminRecord,
  programmes: ProgrammePlanningRecord[],
  programmeFilter: string,
): boolean {
  return programmeFilter === 'All'
    || effectiveTutorProgrammeAllocations(tutor, programmes)
      .some((allocation) => allocation.programmeCode === programmeFilter)
}

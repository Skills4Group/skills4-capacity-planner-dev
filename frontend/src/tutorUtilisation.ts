export type TutorUtilisationTone = 'standard' | 'high' | 'over' | 'unavailable' | 'excluded'

export interface TutorUtilisationResult {
  label: string
  percent: number | null
  tone: TutorUtilisationTone
}

interface TutorUtilisationInput {
  currentLearners: number
  capacity: number
  isActive: boolean
  onMaternityLeave: boolean
}

export function calculateTutorUtilisation({
  currentLearners,
  capacity,
  isActive,
  onMaternityLeave,
}: TutorUtilisationInput): TutorUtilisationResult {
  if (!isActive) return { label: 'Excluded', percent: null, tone: 'excluded' }
  if (onMaternityLeave || !Number.isFinite(capacity) || capacity <= 0) {
    return { label: 'Unavailable', percent: null, tone: 'unavailable' }
  }

  const percent = Math.round((Math.max(0, currentLearners) / capacity) * 1000) / 10
  const label = `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`
  const tone = percent > 100 ? 'over' : percent >= 90 ? 'high' : 'standard'

  return { label, percent, tone }
}

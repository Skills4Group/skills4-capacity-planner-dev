export interface TutorDirectoryCsvRow {
  tutorName: string
  tutorId: string
  teachingAllocations: string
  currentLearners: number
  activeCohorts: number
  maximumCapacity: number
  deliveryRole: string
  maternityLeave: string
  returnMonth: string
  tutorStatus: string
  remaining: number | string
  utilisation: string
  configuration: string
}

const columns: Array<[string, keyof TutorDirectoryCsvRow]> = [
  ['Tutor', 'tutorName'],
  ['Tutor ID', 'tutorId'],
  ['Teaching allocations', 'teachingAllocations'],
  ['Current learners', 'currentLearners'],
  ['Active cohorts', 'activeCohorts'],
  ['Maximum capacity', 'maximumCapacity'],
  ['Delivery role', 'deliveryRole'],
  ['Maternity leave', 'maternityLeave'],
  ['Return month', 'returnMonth'],
  ['Tutor status', 'tutorStatus'],
  ['Remaining', 'remaining'],
  ['Utilisation', 'utilisation'],
  ['Configuration', 'configuration'],
]

function csvCell(value: string | number) {
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`
  }
  return `"${text.replaceAll('"', '""')}"`
}

export function buildTutorDirectoryCsv(rows: TutorDirectoryCsvRow[]) {
  const header = columns.map(([label]) => csvCell(label)).join(',')
  const body = rows.map((row) => (
    columns.map(([, field]) => csvCell(row[field])).join(',')
  ))
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`
}

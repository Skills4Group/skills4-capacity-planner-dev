import { useMemo, useState } from 'react'
import { reportingWorkstreams, type ForecastResponse, type Workstream } from './types'

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatGap(gap: number) {
  if (gap > 0) return `+${gap}`
  if (gap < 0) return `−${Math.abs(gap)}`
  return '0'
}

interface UtilisationViewProps {
  forecast: ForecastResponse
  selectedWorkstream: Workstream | 'All'
  onWorkstreamChange: (workstream: Workstream | 'All') => void
}

export function UtilisationView({
  forecast,
  selectedWorkstream,
  onWorkstreamChange,
}: UtilisationViewProps) {
  const [horizon, setHorizon] = useState<6 | 12 | 18>(6)
  const months = forecast.months.slice(0, horizon)

  const tutors = useMemo(() => {
    const firstMonth = months[0]
    return forecast.tutor_months
      .filter(
        (row) =>
          row.month === firstMonth &&
          (selectedWorkstream === 'All' || row.workstream === selectedWorkstream),
      )
      .sort((left, right) =>
        left.workstream.localeCompare(right.workstream) || left.tutor_name.localeCompare(right.tutor_name),
      )
  }, [forecast.tutor_months, months, selectedWorkstream])

  const rowByTutorAndMonth = useMemo(
    () =>
      new Map(
        forecast.tutor_months.map((row) => [`${row.tutor_id}:${row.month}`, row]),
      ),
    [forecast.tutor_months],
  )

  return (
    <>
      <header className="topbar utilisation-topbar">
        <div>
          <h1>Utilisation</h1>
          <p className="page-intro">Per-tutor rolling caseload projections and capacity gap, month by month.</p>
        </div>
        <div className="utilisation-filters">
          <label htmlFor="utilisation-workstream">
            <span>Subject</span>
            <select
              id="utilisation-workstream"
              value={selectedWorkstream}
              onChange={(event) => onWorkstreamChange(event.target.value as Workstream | 'All')}
            >
              <option value="All">All subjects</option>
              {reportingWorkstreams.map((workstream) => (
                <option key={workstream} value={workstream}>{workstream}</option>
              ))}
            </select>
          </label>
          <label htmlFor="utilisation-horizon">
            <span>Horizon</span>
            <select
              id="utilisation-horizon"
              value={horizon}
              onChange={(event) => setHorizon(Number(event.target.value) as 6 | 12 | 18)}
            >
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value={18}>18 months</option>
            </select>
          </label>
        </div>
      </header>

      <section className="utilisation-card" aria-labelledby="tutor-caseload-title">
        <div className="utilisation-card-heading">
          <h2 id="tutor-caseload-title">Tutor caseload grid</h2>
          <p>
            Each row is a tutor. Learners are allocated within the same workstream. Gap is projected
            caseload minus tutor capacity: positive means a shortage and negative means spare capacity.
          </p>
        </div>

        <div className="utilisation-grid-wrap">
          <table className="utilisation-grid">
            <thead>
              <tr>
                <th className="sticky-tutor" rowSpan={2}>Tutor</th>
                <th className="sticky-workstream" rowSpan={2}>Subject</th>
                <th rowSpan={2}>Capacity</th>
                <th rowSpan={2}>Starting</th>
                {months.map((month) => (
                  <th key={month} colSpan={2} className="month-group">{formatMonth(month)}</th>
                ))}
              </tr>
              <tr>
                {months.map((month) => (
                  <FragmentCells key={month} />
                ))}
              </tr>
            </thead>
            <tbody>
              {tutors.map((tutor) => (
                <tr key={tutor.tutor_id}>
                  <td className="sticky-tutor"><strong>{tutor.tutor_name}</strong><small>{tutor.tutor_id}</small></td>
                  <td className="sticky-workstream"><span className="utilisation-subject">{tutor.workstream}</span></td>
                  <td className="numeric">{tutor.capacity}</td>
                  <td className="numeric">{tutor.opening_caseload}</td>
                  {months.map((month) => {
                    const row = rowByTutorAndMonth.get(`${tutor.tutor_id}:${month}`)
                    const caseload = row?.peak_caseload ?? 0
                    const gap = caseload - (row?.capacity ?? tutor.capacity)
                    const gapTone = gap > 0 ? 'shortage' : gap < 0 ? 'spare' : 'balanced'
                    return (
                      <FragmentCells
                        key={month}
                        caseload={caseload}
                        gap={formatGap(gap)}
                        gapTone={gapTone}
                      />
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

interface FragmentCellsProps {
  caseload?: number
  gap?: string
  gapTone?: 'shortage' | 'spare' | 'balanced'
}

function FragmentCells({ caseload, gap, gapTone }: FragmentCellsProps) {
  if (caseload === undefined) {
    return (
      <>
        <th className="monthly-subhead">Caseload</th>
        <th className="monthly-subhead">Gap</th>
      </>
    )
  }

  return (
    <>
      <td className="numeric monthly-caseload">{caseload}</td>
      <td className="numeric monthly-gap"><span className={`gap-pill ${gapTone}`}>{gap}</span></td>
    </>
  )
}

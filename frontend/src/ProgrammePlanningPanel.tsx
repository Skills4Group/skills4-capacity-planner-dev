import { useEffect, useMemo, useState } from 'react'
import type {
  ProgrammePlanningResponse,
  SessionResponse,
} from './types'

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  timeZone: 'UTC',
})

function academicYear(startYear: number) {
  return `${startYear}/${String(startYear + 1).slice(-2)}`
}

function currentAcademicYearStart() {
  const now = new Date()
  return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1
}

function monthsForAcademicYear(value: string) {
  const startYear = Number(value.slice(0, 4))
  return Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(startYear, 8 + index, 1))
    return date.toISOString().slice(0, 10)
  })
}

interface ProgrammeDraft {
  duration: string
  active: boolean
  starts: Record<string, string>
}

export function ProgrammePlanningPanel() {
  const currentStart = currentAcademicYearStart()
  const years = useMemo(
    () => [currentStart - 1, currentStart, currentStart + 1, currentStart + 2].map(academicYear),
    [currentStart],
  )
  const [selectedYear, setSelectedYear] = useState(academicYear(currentStart))
  const [planning, setPlanning] = useState<ProgrammePlanningResponse | null>(null)
  const [session, setSession] = useState<SessionResponse>({ authenticated: false, is_admin: false, display_name: null })
  const [drafts, setDrafts] = useState<Record<string, ProgrammeDraft>>({})
  const [savingCode, setSavingCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  const months = monthsForAcademicYear(selectedYear)

  useEffect(() => {
    let active = true
    Promise.all([
      fetch(`/api/v1/programme-planning?academic_year=${encodeURIComponent(selectedYear)}`)
        .then((response) => response.ok ? response.json() as Promise<ProgrammePlanningResponse> : Promise.reject()),
      fetch('/api/v1/session')
        .then((response) => response.ok ? response.json() as Promise<SessionResponse> : Promise.reject()),
    ]).then(([payload, nextSession]) => {
      if (!active) return
      setPlanning(payload)
      setSession(nextSession)
      const cohorts = new Map(payload.cohorts.map((cohort) => [`${cohort.programme_code}:${cohort.start_month}`, cohort.planned_starts]))
      setDrafts(Object.fromEntries(payload.programmes.map((programme) => [
        programme.programme_code,
        {
          duration: String(programme.duration_months),
          active: programme.active,
          starts: Object.fromEntries(months.map((month) => [month, String(cohorts.get(`${programme.programme_code}:${month}`) ?? 0)])),
        },
      ])))
      setError('')
    }).catch(() => {
      if (active) setError('Programme planning is temporarily unavailable.')
    })
    return () => { active = false }
  }, [selectedYear])

  function changeDraft(programmeCode: string, change: Partial<ProgrammeDraft>) {
    setDrafts((current) => ({
      ...current,
      [programmeCode]: { ...current[programmeCode], ...change },
    }))
  }

  async function saveProgramme(programmeCode: string) {
    const draft = drafts[programmeCode]
    const duration = Number(draft.duration)
    if (!session.is_admin || !Number.isInteger(duration) || duration < 3 || duration > 60) return
    setSavingCode(programmeCode)
    setError('')
    try {
      const programmeResponse = await fetch(`/api/v1/programmes/${encodeURIComponent(programmeCode)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration_months: duration, active: draft.active }),
      })
      if (!programmeResponse.ok) throw new Error('Programme setting could not be saved')
      const originalStarts = new Map(
        planning?.cohorts.filter((cohort) => cohort.programme_code === programmeCode)
          .map((cohort) => [cohort.start_month, cohort.planned_starts]) ?? [],
      )
      const changedMonths = months.filter((month) => Number(draft.starts[month] || 0) !== (originalStarts.get(month) ?? 0))
      const responses = await Promise.all(changedMonths.map((month) => fetch(
        `/api/v1/planned-cohorts/${encodeURIComponent(programmeCode)}/${month}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planned_starts: Number(draft.starts[month] || 0) }),
        },
      )))
      if (responses.some((response) => !response.ok)) throw new Error('One or more planned-start months could not be saved')
      const refreshed = await fetch(`/api/v1/programme-planning?academic_year=${encodeURIComponent(selectedYear)}`)
      if (refreshed.ok) setPlanning(await refreshed.json() as ProgrammePlanningResponse)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Programme planning could not be saved')
    } finally {
      setSavingCode(null)
    }
  }

  if (!planning && !error) return <section className="programme-planning-card"><p>Loading programme plan…</p></section>

  return (
    <section className="programme-planning-card" aria-labelledby="programme-planning-title">
      <div className="programme-planning-heading">
        <div><p className="eyebrow">Academic-year intake plan</p><h2 id="programme-planning-title">Programme durations and planned starts</h2><p>Planned starts are a programme-level minimum in the predictive model. Duration controls how long each planned cohort remains in projected demand.</p></div>
        <label><span>Academic year</span><select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>{years.map((year) => <option key={year}>{year}</option>)}</select></label>
      </div>
      {error && <div className="tutor-message error" role="alert">{error}</div>}
      {!session.is_admin && planning && <div className="tutor-message">Programme plans are read only until an authorised administrator signs in.</div>}
      {planning && <div className="programme-planning-table-wrap"><table className="programme-planning-table"><thead><tr><th>Programme</th><th>Workstream</th><th>Duration</th>{months.map((month) => <th key={month}>{monthFormatter.format(new Date(`${month}T00:00:00Z`))}</th>)}<th></th></tr></thead><tbody>{planning.programmes.filter((programme) => programme.workstream !== 'Operations').map((programme) => { const draft = drafts[programme.programme_code]; if (!draft) return null; const validDuration = Number.isInteger(Number(draft.duration)) && Number(draft.duration) >= 3 && Number(draft.duration) <= 60; return <tr key={programme.programme_code} className={!draft.active ? 'inactive-programme-row' : ''}><td><strong>{programme.display_name}</strong>{programme.level && <small>{programme.level}</small>}</td><td>{programme.workstream}</td><td><div className="programme-duration-input"><input type="number" min="3" max="60" value={draft.duration} disabled={!session.is_admin} onChange={(event) => changeDraft(programme.programme_code, { duration: event.target.value })} /><span>months</span></div></td>{months.map((month) => <td key={month}><input className="planned-start-input" aria-label={`${programme.display_name} planned starts for ${month}`} type="number" min="0" step="1" value={draft.starts[month]} disabled={!session.is_admin || !draft.active} onChange={(event) => { if (!/^\d*$/.test(event.target.value)) return; changeDraft(programme.programme_code, { starts: { ...draft.starts, [month]: event.target.value } }) }} /></td>)}<td><button className="save-tutor-button" disabled={!session.is_admin || !validDuration || savingCode !== null} onClick={() => saveProgramme(programme.programme_code)}>{savingCode === programme.programme_code ? 'Saving…' : 'Save row'}</button></td></tr> })}</tbody></table></div>}
      <p className="predictive-scenario-footnote">All entries are stored only in the Capacity Tracker database. Attendance remains read only.</p>
    </section>
  )
}

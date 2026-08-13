import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { createDemoForecast } from './demoForecast'
import { ForecastView } from './ForecastView'
import { UtilisationView } from './UtilisationView'
import { TutorsView } from './TutorsView'
import { reportingWorkstreams, type ForecastResponse, type TutorMonth, type Workstream } from './types'
const demoForecast = createDemoForecast()
const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const navigation = [
  { label: 'Dashboard', path: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
  { label: 'Forecast', path: 'M3 18 9 12l4 4 8-10M16 6h5v5' },
  { label: 'Utilisation', path: 'M3 12h4l2-6 4 12 3-9 2 3h3' },
  { label: 'Learners', path: 'm3 9 9-5 9 5-9 5zM7 12v4c3 2 7 2 10 0v-4' },
  { label: 'Tutors', path: 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75' },
  { label: 'Settings', path: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1H3v-4h.08A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.52V3h4v.08A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.52 1H21v4h-.08A1.7 1.7 0 0 0 19.4 15' },
]

function LineIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function statusFor(row: TutorMonth) {
  if (row.remaining_capacity < 0) return { label: 'Over capacity', tone: 'danger' }
  if (row.utilisation_percent >= 95) return { label: 'Nearly full', tone: 'warning' }
  return { label: 'Available', tone: 'success' }
}

function App() {
  const [activeView, setActiveView] = useState<'Dashboard' | 'Forecast' | 'Utilisation' | 'Tutors'>('Dashboard')
  const [forecast, setForecast] = useState<ForecastResponse>(demoForecast)
  const [dataMode, setDataMode] = useState<'live' | 'demo'>('demo')
  const [selectedMonth, setSelectedMonth] = useState(demoForecast.months[0])
  const [selectedWorkstream, setSelectedWorkstream] = useState<Workstream | 'All'>('All')
  const [search, setSearch] = useState('')
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [capacityOverride, setCapacityOverride] = useState(50)

  const refreshForecast = useCallback(async () => {
    const response = await fetch('/api/v1/forecast')
    if (!response.ok) throw new Error('Forecast API unavailable')
    const payload = await response.json() as ForecastResponse
    setForecast(payload)
    setSelectedMonth((current) => payload.months.includes(current) ? current : payload.months[0])
    setDataMode('live')
  }, [])

  useEffect(() => {
    refreshForecast().catch(() => setDataMode('demo'))
  }, [refreshForecast])

  const monthRows = useMemo(
    () => forecast.tutor_months.filter((row) => row.month === selectedMonth),
    [forecast, selectedMonth],
  )
  const visibleRows = useMemo(() => {
    const query = search.trim().toLowerCase()
    return monthRows.filter(
      (row) =>
        (selectedWorkstream === 'All' || row.workstream === selectedWorkstream) &&
        (!query || row.tutor_name.toLowerCase().includes(query)),
    )
  }, [monthRows, search, selectedWorkstream])
  const scenarioRows = visibleRows.map((row) => {
    if (!scenarioOpen) return row
    return {
      ...row,
      capacity: capacityOverride,
      remaining_capacity: capacityOverride - row.peak_caseload,
      utilisation_percent: Math.round((row.peak_caseload / capacityOverride) * 1000) / 10,
    }
  })
  const summary = useMemo(() => {
    const capacity = scenarioRows.reduce((sum, row) => sum + row.capacity, 0)
    const learners = scenarioRows.reduce((sum, row) => sum + row.peak_caseload, 0)
    const remaining = capacity - learners
    return {
      tutors: scenarioRows.length,
      capacity,
      learners,
      remaining,
      utilisation: capacity ? Math.round((learners / capacity) * 1000) / 10 : 0,
      required: Math.ceil(Math.max(0, -remaining) / capacityOverride),
    }
  }, [capacityOverride, scenarioRows])
  const selectedStreamRows = forecast.workstream_months.filter((row) => row.month === selectedMonth)
  const trendRows = forecast.months.map((month) => {
    const rows = forecast.workstream_months.filter(
      (row) => row.month === month && (selectedWorkstream === 'All' || row.workstream === selectedWorkstream),
    )
    return {
      month,
      capacity: rows.reduce((sum, row) => sum + row.total_capacity, 0),
      learners: rows.reduce((sum, row) => sum + row.peak_projected_caseload, 0),
    }
  })
  const chartMax = Math.max(...trendRows.map((row) => Math.max(row.capacity, row.learners)), 1)

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark" aria-label="Skills 4 Capacity Tracker">
          <img className="brand-logo" src="/skills4-logo.png" alt="Skills4" />
          <strong className="brand-product">Capacity Forecaster</strong>
        </div>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <button
              key={item.label}
              className={`nav-item ${activeView === item.label ? 'active' : ''}`}
              onClick={() => {
                if (item.label === 'Dashboard' || item.label === 'Forecast' || item.label === 'Utilisation' || item.label === 'Tutors') setActiveView(item.label)
              }}
            >
              <LineIcon path={item.path} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`status-dot ${dataMode}`}></span>
          <div><strong>{dataMode === 'live' ? 'API connected' : 'Demo dataset'}</strong><small>Attendance remains read-only</small></div>
        </div>
      </aside>

      <main>
        {activeView === 'Forecast' ? (
          <ForecastView
            forecast={forecast}
            selectedWorkstream={selectedWorkstream}
            onWorkstreamChange={setSelectedWorkstream}
          />
        ) : activeView === 'Utilisation' ? (
          <UtilisationView
            forecast={forecast}
            selectedWorkstream={selectedWorkstream}
            onWorkstreamChange={setSelectedWorkstream}
          />
        ) : activeView === 'Tutors' ? (
          <TutorsView onForecastRefresh={refreshForecast} />
        ) : (
          <>
        <header className="topbar">
          <div><p className="eyebrow">Tutor capacity planning</p><h1>Dashboard</h1><p className="page-intro">Current capacity snapshot and rolling 18-month projections.</p></div>
          <div className="topbar-actions">
            <label className="month-control">
              <span>Forecast month</span>
              <select value={selectedMonth} onChange={(event) => setSelectedMonth(event.target.value)}>
                {forecast.months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}
              </select>
            </label>
            <button className="scenario-button" onClick={() => setScenarioOpen((value) => !value)}>
              {scenarioOpen ? 'Close scenario' : 'Model scenario'}
            </button>
          </div>
        </header>

        <section className="summary-grid" aria-label="Capacity summary">
          <article className="summary-card featured"><p>Remaining capacity</p><strong>{summary.remaining}</strong><span>{summary.remaining >= 0 ? 'learner places available' : 'learner places short'}</span><i>01</i></article>
          <article className="summary-card"><p>Projected learners</p><strong>{summary.learners}</strong><span>at monthly peak</span><i>02</i></article>
          <article className="summary-card"><p>Total capacity</p><strong>{summary.capacity}</strong><span>across {summary.tutors} tutors</span><i>03</i></article>
          <article className="summary-card"><p>Utilisation</p><strong>{summary.utilisation}%</strong><span>{summary.required ? `${summary.required} additional tutors required` : 'within available capacity'}</span><i>04</i></article>
        </section>

        {scenarioOpen && (
          <section className="scenario-panel" aria-label="Capacity scenario controls">
            <div><p className="eyebrow">Scenario preview</p><h2>Change the maximum caseload</h2><p>Preview the effect without changing saved tutor settings.</p></div>
            <label><span>Learners per tutor</span><input type="number" min="10" max="100" value={capacityOverride} onChange={(event) => setCapacityOverride(Number(event.target.value))} /></label>
          </section>
        )}

        <section className="workstream-strip" aria-label="Workstream filters">
          <button className={selectedWorkstream === 'All' ? 'active' : ''} onClick={() => setSelectedWorkstream('All')}><span>All workstreams</span><strong>{selectedStreamRows.reduce((sum, row) => sum + row.remaining_capacity, 0)} places</strong></button>
          {reportingWorkstreams.map((workstream) => {
            const row = selectedStreamRows.find((item) => item.workstream === workstream)
            return <button key={workstream} data-stream={workstream} className={selectedWorkstream === workstream ? 'active' : ''} onClick={() => setSelectedWorkstream(workstream)}><span>{workstream}</span><strong>{row?.remaining_capacity ?? 0} places</strong></button>
          })}
        </section>

        <section className="forecast-card">
          <div className="section-heading"><div><p className="eyebrow">Demand against capacity</p><h2>Rolling monthly outlook</h2></div><div className="legend"><span className="capacity-key">Capacity</span><span className="demand-key">Projected learners</span></div></div>
          <div className="trend-chart" role="img" aria-label="Projected learners compared with tutor capacity across 18 months">
            {trendRows.map((row) => (
              <div className="trend-column" key={row.month}>
                <div className="bar-area"><span className="capacity-bar" style={{ height: `${(row.capacity / chartMax) * 100}%` }}></span><span className={`demand-bar ${row.learners > row.capacity ? 'over' : ''}`} style={{ height: `${(row.learners / chartMax) * 100}%` }}></span></div>
                <small>{formatMonth(row.month).replace(' ', '\n')}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="tutor-card">
          <div className="section-heading table-heading">
            <div><p className="eyebrow">Tutor detail</p><h2>{selectedWorkstream === 'All' ? 'All tutors' : `${selectedWorkstream} tutors`}</h2></div>
            <label className="search-field"><span className="sr-only">Search tutors</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search tutor" /></label>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Tutor</th><th>Workstream</th><th>Peak learners</th><th>Forecast starts</th><th>Offboarding</th><th>Capacity</th><th>Remaining</th><th>Status</th></tr></thead>
              <tbody>
                {scenarioRows.map((row) => {
                  const status = statusFor(row)
                  return <tr key={row.tutor_id}><td><strong>{row.tutor_name}</strong><small>{row.tutor_id}</small></td><td><span className="stream-pill" data-stream={row.workstream}>{row.workstream}</span></td><td>{row.peak_caseload}</td><td className="positive">+{row.forecast_starts}</td><td className="muted">−{row.offboarded}</td><td>{row.capacity}</td><td><strong className={row.remaining_capacity < 0 ? 'negative' : ''}>{row.remaining_capacity}</strong></td><td><span className={`status-pill ${status.tone}`}>{status.label}</span></td></tr>
                })}
              </tbody>
            </table>
          </div>
        </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App

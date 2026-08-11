import { useMemo, useState } from 'react'
import type { ForecastResponse, Workstream } from './types'

const workstreams: Workstream[] = ['Dental', 'Pharmacy', 'Housing', 'Science']

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

interface ForecastViewProps {
  forecast: ForecastResponse
  selectedWorkstream: Workstream | 'All'
  onWorkstreamChange: (workstream: Workstream | 'All') => void
}

interface HiringEvent {
  month: string
  workstream: Workstream
  hires: number
}

export function ForecastView({
  forecast,
  selectedWorkstream,
  onWorkstreamChange,
}: ForecastViewProps) {
  const [horizon, setHorizon] = useState<6 | 12 | 18>(18)
  const months = forecast.months.slice(0, horizon)

  const selectedStreams = useMemo(
    () => workstreams.filter((workstream) => selectedWorkstream === 'All' || workstream === selectedWorkstream),
    [selectedWorkstream],
  )

  const resourcePlan = useMemo(() => {
    const plannedHires = new Map<Workstream, number>()
    const hiringEvents: HiringEvent[] = []

    const monthly = months.map((month) => {
      const rows = forecast.workstream_months.filter(
        (row) => row.month === month && selectedStreams.includes(row.workstream),
      )
      let hiresThisMonth = 0
      const monthEvents: HiringEvent[] = []

      rows.forEach((row) => {
        const alreadyPlanned = plannedHires.get(row.workstream) ?? 0
        const newHires = Math.max(0, row.additional_tutors_required - alreadyPlanned)
        if (newHires > 0) {
          const event = { month, workstream: row.workstream, hires: newHires }
          monthEvents.push(event)
          hiringEvents.push(event)
          hiresThisMonth += newHires
          plannedHires.set(row.workstream, alreadyPlanned + newHires)
        }
      })

      const currentStaff = rows.reduce((sum, row) => sum + row.tutors, 0)
      const staffRequired = currentStaff + rows.reduce((sum, row) => sum + row.additional_tutors_required, 0)
      const plannedStaff = currentStaff + selectedStreams.reduce(
        (sum, workstream) => sum + (plannedHires.get(workstream) ?? 0),
        0,
      )
      const projectedLearners = rows.reduce((sum, row) => sum + row.peak_projected_caseload, 0)

      return {
        month,
        currentStaff,
        staffRequired,
        plannedStaff,
        hiresThisMonth,
        monthEvents,
        projectedLearners,
        currentTeamCovers: staffRequired <= currentStaff,
      }
    })

    return { monthly, hiringEvents }
  }, [forecast.workstream_months, months, selectedStreams])

  const summary = useMemo(() => {
    const currentStaff = resourcePlan.monthly[0]?.currentStaff ?? 0
    const totalHires = resourcePlan.hiringEvents.reduce((sum, event) => sum + event.hires, 0)
    const peakStaffRequired = Math.max(...resourcePlan.monthly.map((row) => row.staffRequired), currentStaff)
    const firstGapIndex = resourcePlan.monthly.findIndex((row) => !row.currentTeamCovers)
    const currentCoverageThrough =
      firstGapIndex < 0
        ? months.at(-1)
        : firstGapIndex === 0
          ? undefined
          : months[firstGapIndex - 1]
    return {
      currentStaff,
      totalHires,
      peakStaffRequired,
      plannedHeadcount: currentStaff + totalHires,
      firstHire: resourcePlan.hiringEvents[0],
      currentCoverageThrough,
      currentTeamCoversHorizon: resourcePlan.hiringEvents.length === 0,
    }
  }, [months, resourcePlan])

  const workstreamPlans = useMemo(
    () => selectedStreams.map((workstream) => {
      const rows = forecast.workstream_months.filter(
        (row) => months.includes(row.month) && row.workstream === workstream,
      )
      const events = resourcePlan.hiringEvents.filter((event) => event.workstream === workstream)
      const hires = events.reduce((sum, event) => sum + event.hires, 0)
      const currentStaff = rows[0]?.tutors ?? 0
      return {
        workstream,
        currentStaff,
        hires,
        plannedStaff: currentStaff + hires,
        firstHire: events[0],
        peakLearners: Math.max(...rows.map((row) => row.peak_projected_caseload), 0),
      }
    }),
    [forecast.workstream_months, months, resourcePlan.hiringEvents, selectedStreams],
  )

  const chartMax = Math.max(...resourcePlan.monthly.map((row) => row.plannedStaff), summary.currentStaff, 1)

  return (
    <>
      <header className="topbar forecast-topbar">
        <div>
          <h1>Forecast</h1>
          <p className="page-intro">When additional tutor staff are needed, how many to recruit, and where.</p>
        </div>
        <div className="forecast-filters">
          <label htmlFor="forecast-workstream">
            <span>Subject</span>
            <select
              id="forecast-workstream"
              value={selectedWorkstream}
              onChange={(event) => onWorkstreamChange(event.target.value as Workstream | 'All')}
            >
              <option value="All">All subjects</option>
              {workstreams.map((workstream) => (
                <option key={workstream} value={workstream}>{workstream}</option>
              ))}
            </select>
          </label>
          <label htmlFor="forecast-horizon">
            <span>Horizon</span>
            <select
              id="forecast-horizon"
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

      <section className={`staffing-answer ${summary.currentTeamCoversHorizon ? 'covered' : 'action'}`} aria-label="Staffing recommendation">
        <span className="staffing-answer-icon">{summary.currentTeamCoversHorizon ? '✓' : '!'}</span>
        <div>
          <p>{summary.currentTeamCoversHorizon ? 'Current staffing is sufficient' : 'Recruitment is required'}</p>
          {summary.currentTeamCoversHorizon ? (
            <h2>Your current {summary.currentStaff} tutor staff cover demand through {formatMonth(months.at(-1) ?? months[0])}.</h2>
          ) : (
            <h2>
              Recruit {summary.totalHires} additional {summary.totalHires === 1 ? 'tutor' : 'tutors'} across the selected horizon.
              Current staffing covers demand through {summary.currentCoverageThrough ? formatMonth(summary.currentCoverageThrough) : 'the start of the forecast'}.
            </h2>
          )}
        </div>
      </section>

      <section className="forecast-summary-grid" aria-label="Staffing forecast summary">
        <article className="forecast-summary-card">
          <p>Current tutor staff</p>
          <strong>{summary.currentStaff}</strong>
          <span>available today</span>
        </article>
        <article className={`forecast-summary-card ${summary.totalHires > 0 ? 'attention' : ''}`}>
          <p>New tutors to recruit</p>
          <strong>{summary.totalHires}</strong>
          <span>{summary.totalHires > 0 ? 'to cover the full horizon' : 'current team is sufficient'}</span>
        </article>
        <article className="forecast-summary-card featured">
          <p>First hire needed</p>
          <strong className="summary-month">{summary.firstHire ? formatMonth(summary.firstHire.month) : 'None'}</strong>
          <span>{summary.firstHire ? `${summary.firstHire.hires} ${summary.firstHire.workstream} tutor${summary.firstHire.hires > 1 ? 's' : ''}` : 'no recruitment trigger'}</span>
        </article>
        <article className="forecast-summary-card">
          <p>Planned tutor headcount</p>
          <strong>{summary.plannedHeadcount}</strong>
          <span>after recommended recruitment</span>
        </article>
      </section>

      <section className="hiring-plan-card" aria-labelledby="hiring-plan-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recommended action</p>
            <h2 id="hiring-plan-title">Recruitment schedule</h2>
          </div>
          <span className="plan-total">{summary.totalHires} total hire{summary.totalHires === 1 ? '' : 's'}</span>
        </div>
        {resourcePlan.hiringEvents.length ? (
          <div className="hiring-timeline">
            {resourcePlan.hiringEvents.map((event, index) => (
              <article key={`${event.month}-${event.workstream}`}>
                <span className="timeline-step">{index + 1}</span>
                <div>
                  <time>{formatMonth(event.month)}</time>
                  <h3>Hire {event.hires} {event.workstream} tutor{event.hires > 1 ? 's' : ''}</h3>
                  <p>Have the new resource in place by the start of this month.</p>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="no-hiring-plan"><strong>No recruitment required</strong><span>The current team covers every month in the selected horizon.</span></div>
        )}
      </section>

      <section className="resource-chart-card" aria-labelledby="resource-chart-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Staffing coverage by month</p>
            <h2 id="resource-chart-title">Current, required and planned staff</h2>
          </div>
          <div className="resource-legend">
            <span className="available-key">Current staff</span>
            <span className="required-key">Staff required</span>
            <span className="planned-key">Planned staff</span>
          </div>
        </div>
        <div
          className="resource-chart"
          role="img"
          aria-label="Current tutor staff compared with required and planned staffing by month"
          style={{ gridTemplateColumns: `repeat(${resourcePlan.monthly.length}, minmax(44px, 1fr))` }}
        >
          {resourcePlan.monthly.map((row) => (
            <div className="resource-column" key={row.month}>
              <div className="resource-bars">
                <span className="resource-bar available" style={{ height: `${(row.currentStaff / chartMax) * 100}%` }}><i>{row.currentStaff}</i></span>
                <span className={`resource-bar required ${!row.currentTeamCovers ? 'shortage' : ''}`} style={{ height: `${(row.staffRequired / chartMax) * 100}%` }}><i>{row.staffRequired}</i></span>
                <span className="resource-bar planned" style={{ height: `${(row.plannedStaff / chartMax) * 100}%` }}><i>{row.plannedStaff}</i></span>
              </div>
              <small>{formatMonth(row.month).replace(' ', '\n')}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="workstream-outlook" aria-labelledby="workstream-plan-title">
        <div className="section-heading">
          <div><p className="eyebrow">Staffing by subject</p><h2 id="workstream-plan-title">Workstream recruitment plan</h2></div>
        </div>
        <div className="outlook-grid">
          {workstreamPlans.map((row) => (
            <article key={row.workstream} className={row.hires > 0 ? 'needs-resource' : ''}>
              <div className="outlook-card-heading">
                <h3>{row.workstream}</h3>
                <span>{row.hires > 0 ? `${row.hires} hire${row.hires > 1 ? 's' : ''}` : 'Team sufficient'}</span>
              </div>
              <dl>
                <div><dt>Current staff</dt><dd>{row.currentStaff}</dd></div>
                <div><dt>New hires</dt><dd className={row.hires > 0 ? 'negative' : ''}>{row.hires}</dd></div>
                <div><dt>Planned team</dt><dd>{row.plannedStaff}</dd></div>
                <div><dt>Peak learners</dt><dd>{row.peakLearners}</dd></div>
              </dl>
              <p>{row.firstHire ? `First tutor needed by ${formatMonth(row.firstHire.month)}` : 'Current staffing covers this horizon'}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="resource-table-card" aria-labelledby="resource-table-title">
        <div className="section-heading">
          <div><p className="eyebrow">Monthly staffing check</p><h2 id="resource-table-title">Coverage and hiring requirement</h2></div>
        </div>
        <div className="resource-table-wrap">
          <table className="resource-table">
            <thead>
              <tr><th>Month</th><th>Projected learners</th><th>Current staff</th><th>Staff required</th><th>Hire this month</th><th>Planned staff</th><th>Without recruitment</th></tr>
            </thead>
            <tbody>
              {resourcePlan.monthly.map((row) => (
                <tr key={row.month}>
                  <td><strong>{formatMonth(row.month)}</strong></td>
                  <td>{row.projectedLearners}</td>
                  <td>{row.currentStaff}</td>
                  <td>{row.staffRequired}</td>
                  <td><strong className={row.hiresThisMonth > 0 ? 'negative' : ''}>{row.hiresThisMonth > 0 ? `+${row.hiresThisMonth}` : '0'}</strong></td>
                  <td>{row.plannedStaff}</td>
                  <td><span className={`resource-status ${row.currentTeamCovers ? 'covered' : 'gap'}`}>{row.currentTeamCovers ? 'Enough staff' : 'Recruitment needed'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

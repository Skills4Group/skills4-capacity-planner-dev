import { useMemo, useState } from 'react'
import { selectRollingMonths } from './rollingMonths'
import {
  reportingWorkstreams,
  type ForecastResponse,
  type ProgrammeMonth,
  type WorkstreamMonth,
} from './types'
import {
  isProgrammeFilter,
  reportingFilterLabels,
  reportingFilterOptions,
  type ReportingFilter,
  type ReportingScope,
} from './reportingFilters'

const NEW_TUTOR_CAPACITY = 50

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
  selectedWorkstream: ReportingFilter
  onWorkstreamChange: (workstream: ReportingFilter) => void
}

interface HiringEvent {
  month: string
  scope: ReportingScope
  hires: number
}

type PlanningMonth = WorkstreamMonth | ProgrammeMonth

function rowScope(row: PlanningMonth): ReportingScope {
  return 'programme_code' in row ? row.programme_code as ReportingScope : row.workstream
}

function scenarioKey(month: string, scope: ReportingScope) {
  return `${month}:${scope}`
}

function scenarioLearnerCount(value: string | undefined, baseline: number) {
  if (value === undefined) return baseline
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : baseline
}

export function ForecastView({
  forecast,
  selectedWorkstream,
  onWorkstreamChange,
}: ForecastViewProps) {
  const [horizon, setHorizon] = useState<6 | 12 | 18>(18)
  const [scenarioEnabled, setScenarioEnabled] = useState(false)
  const [scenarioValues, setScenarioValues] = useState<Record<string, string>>({})
  const months = selectRollingMonths(forecast.months, horizon)

  const selectedStreams = useMemo<ReportingScope[]>(
    () => selectedWorkstream === 'All'
      ? reportingWorkstreams
      : [selectedWorkstream],
    [selectedWorkstream],
  )

  const planningRows = useMemo<PlanningMonth[]>(() => (
    isProgrammeFilter(selectedWorkstream)
      ? forecast.programme_months.filter((row) => row.programme_code === selectedWorkstream)
      : forecast.workstream_months
  ), [forecast.programme_months, forecast.workstream_months, selectedWorkstream])

  const modeledWorkstreamMonths = useMemo(
    () => planningRows.map((row): PlanningMonth => {
      if (!scenarioEnabled) return row
      const projectedLearners = scenarioLearnerCount(
        scenarioValues[scenarioKey(row.month, rowScope(row))],
        row.peak_projected_caseload,
      )
      const remainingCapacity = row.total_capacity - projectedLearners
      return {
        ...row,
        peak_projected_caseload: projectedLearners,
        remaining_capacity: remainingCapacity,
        utilisation_percent: row.total_capacity
          ? Math.round((projectedLearners / row.total_capacity) * 1000) / 10
          : 0,
        additional_tutors_required: Math.ceil(
          Math.max(0, -remainingCapacity) / NEW_TUTOR_CAPACITY,
        ),
      }
    }),
    [planningRows, scenarioEnabled, scenarioValues],
  )

  const baselineRows = useMemo(
    () => new Map(
      planningRows.map((row) => [scenarioKey(row.month, rowScope(row)), row]),
    ),
    [planningRows],
  )

  const scenarioChangeCount = Object.keys(scenarioValues).length

  const resourcePlan = useMemo(() => {
    const plannedHires = new Map<ReportingScope, number>()
    const hiringEvents: HiringEvent[] = []

    const monthly = months.map((month) => {
      const rows = modeledWorkstreamMonths.filter(
        (row) => row.month === month && selectedStreams.includes(rowScope(row)),
      )
      let hiresThisMonth = 0
      const monthEvents: HiringEvent[] = []

      rows.forEach((row) => {
        const scope = rowScope(row)
        const alreadyPlanned = plannedHires.get(scope) ?? 0
        const newHires = Math.max(0, row.additional_tutors_required - alreadyPlanned)
        if (newHires > 0) {
          const event = { month, scope, hires: newHires }
          monthEvents.push(event)
          hiringEvents.push(event)
          hiresThisMonth += newHires
          plannedHires.set(scope, alreadyPlanned + newHires)
        }
      })

      const currentStaff = rows.reduce((sum, row) => sum + row.tutors, 0)
      const staffRequired = currentStaff + rows.reduce((sum, row) => sum + row.additional_tutors_required, 0)
      const plannedStaff = currentStaff + selectedStreams.reduce(
        (sum, scope) => sum + (plannedHires.get(scope) ?? 0),
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
  }, [modeledWorkstreamMonths, months, selectedStreams])

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
    () => selectedStreams.map((scope) => {
      const rows = modeledWorkstreamMonths.filter(
        (row) => months.includes(row.month) && rowScope(row) === scope,
      )
      const events = resourcePlan.hiringEvents.filter((event) => event.scope === scope)
      const hires = events.reduce((sum, event) => sum + event.hires, 0)
      const currentStaff = rows[0]?.tutors ?? 0
      return {
        scope,
        currentStaff,
        hires,
        plannedStaff: currentStaff + hires,
        firstHire: events[0],
        peakLearners: Math.max(...rows.map((row) => row.peak_projected_caseload), 0),
      }
    }),
    [modeledWorkstreamMonths, months, resourcePlan.hiringEvents, selectedStreams],
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
              onChange={(event) => onWorkstreamChange(event.target.value as ReportingFilter)}
            >
              {reportingFilterOptions.map((filter) => (
                <option key={filter} value={filter}>{reportingFilterLabels[filter]}</option>
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
          <button
            type="button"
            className={`forecast-scenario-toggle ${scenarioEnabled ? 'active' : ''}`}
            aria-pressed={scenarioEnabled}
            onClick={() => setScenarioEnabled((current) => !current)}
          >
            <span>{scenarioEnabled ? 'Scenario active' : 'Model scenario'}</span>
            <small>{scenarioEnabled ? `${scenarioChangeCount} changed` : 'Enter demand'}</small>
          </button>
        </div>
      </header>

      {scenarioEnabled && (
        <section className="forecast-scenario-card" aria-labelledby="forecast-scenario-title">
          <div className="forecast-scenario-heading">
            <div>
              <p className="eyebrow">Temporary planning model</p>
              <h2 id="forecast-scenario-title">Projected active learners by month</h2>
              <p>
                Enter the total learners expected to occupy tutor capacity. Values replace the live
                baseline for this scenario only and are never saved.
              </p>
            </div>
            <div className="forecast-scenario-actions">
              <span>{scenarioChangeCount} override{scenarioChangeCount === 1 ? '' : 's'}</span>
              <button type="button" onClick={() => setScenarioValues({})} disabled={!scenarioChangeCount}>
                Reset to baseline
              </button>
            </div>
          </div>
          <div className="forecast-scenario-table-wrap">
            <table className="forecast-scenario-table">
              <thead>
                <tr>
                  <th>Month</th>
                  {selectedStreams.map((scope) => <th key={scope}>{reportingFilterLabels[scope]}</th>)}
                  <th>Total learners</th>
                </tr>
              </thead>
              <tbody>
                {months.map((month) => {
                  const total = selectedStreams.reduce((sum, scope) => {
                    const baseline = baselineRows.get(scenarioKey(month, scope))
                    return sum + scenarioLearnerCount(
                      scenarioValues[scenarioKey(month, scope)],
                      baseline?.peak_projected_caseload ?? 0,
                    )
                  }, 0)
                  return (
                    <tr key={month}>
                      <td><strong>{formatMonth(month)}</strong></td>
                      {selectedStreams.map((scope) => {
                        const key = scenarioKey(month, scope)
                        const baseline = baselineRows.get(key)?.peak_projected_caseload ?? 0
                        const overridden = Object.hasOwn(scenarioValues, key)
                        return (
                          <td key={scope}>
                            <input
                              className={overridden ? 'overridden' : ''}
                              aria-label={`${reportingFilterLabels[scope]} projected active learners for ${formatMonth(month)}`}
                              type="number"
                              min="0"
                              step="1"
                              value={scenarioValues[key] ?? String(baseline)}
                              onChange={(event) => setScenarioValues((current) => ({
                                ...current,
                                [key]: event.target.value,
                              }))}
                            />
                          </td>
                        )
                      })}
                      <td><strong>{total}</strong></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="forecast-scenario-footnote">
            Additional tutors are calculated at {NEW_TUTOR_CAPACITY} learner places per new tutor,
            using current effective capacity in each workstream. Operations remains excluded.
          </p>
        </section>
      )}

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
          <span>{summary.firstHire ? `${summary.firstHire.hires} ${reportingFilterLabels[summary.firstHire.scope]} tutor${summary.firstHire.hires > 1 ? 's' : ''}` : 'no recruitment trigger'}</span>
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
              <article key={`${event.month}-${event.scope}`}>
                <span className="timeline-step">{index + 1}</span>
                <div>
                  <time>{formatMonth(event.month)}</time>
                  <h3>Hire {event.hires} {reportingFilterLabels[event.scope]} tutor{event.hires > 1 ? 's' : ''}</h3>
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
            <article key={row.scope} className={row.hires > 0 ? 'needs-resource' : ''}>
              <div className="outlook-card-heading">
                <h3>{reportingFilterLabels[row.scope]}</h3>
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

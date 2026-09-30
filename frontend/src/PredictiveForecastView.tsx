import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  applyPredictiveScenario,
  draftHasValues,
  scenarioKey,
  type PredictiveScenarioRow,
  type ScenarioDrafts,
  type ScenarioField,
} from './predictiveScenario'
import {
  type PredictiveConfidence,
  type PredictiveForecastResponse,
  type PredictiveProgrammeSummary,
  type PredictiveWorkstreamSummary,
} from './types'
import { ProgrammePlanningPanel } from './ProgrammePlanningPanel'
import {
  isProgrammeFilter,
  pharmacyProgrammeFilters,
  reportingFilterLabels,
  reportingFilterOptions,
  reportingScopeOptions,
  type ReportingFilter,
  type ReportingScope,
} from './reportingFilters'
import { reportingWorkstreams } from './types'

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const fullDateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

const confidenceCopy: Record<PredictiveConfidence, { label: string; description: string }> = {
  p50: { label: 'P50 — expected', description: 'Balanced planning estimate' },
  p80: { label: 'P80 — prudent', description: 'Recommended staffing view' },
  p90: { label: 'P90 — cautious', description: 'Higher demand allowance' },
}

const scenarioFields: Array<{
  field: ScenarioField
  label: string
  shortLabel: string
}> = [
  { field: 'starters', label: 'Starters', shortLabel: 'Starters' },
  { field: 'bil', label: 'Breaks in Learning', shortLabel: 'BiL' },
  { field: 'bilReturns', label: 'Returns from Breaks in Learning', shortLabel: 'BiL returns' },
  { field: 'withdrawn', label: 'Withdrawn', shortLabel: 'WD' },
  { field: 'outOfFunding', label: 'Out of Funding', shortLabel: 'OOF' },
]

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatDate(value: string) {
  return fullDateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function signed(value: number) {
  return value > 0 ? `+${value}` : `${value}`
}

interface PredictiveForecastViewProps {
  selectedWorkstream: ReportingFilter
  onWorkstreamChange: (workstream: ReportingFilter) => void
}

export function PredictiveForecastView({
  selectedWorkstream,
  onWorkstreamChange,
}: PredictiveForecastViewProps) {
  const [forecast, setForecast] = useState<PredictiveForecastResponse | null>(null)
  const [confidence, setConfidence] = useState<PredictiveConfidence>('p80')
  const [horizon, setHorizon] = useState<6 | 12 | 18>(18)
  const [source, setSource] = useState<'live' | 'demo'>('live')
  const [error, setError] = useState('')
  const [scenarioOpen, setScenarioOpen] = useState(false)
  const [scenarioWorkstream, setScenarioWorkstream] = useState<ReportingScope>('pharmacy-general')
  const [scenarioDrafts, setScenarioDrafts] = useState<ScenarioDrafts>({})

  const loadForecast = useCallback(async () => {
    try {
      let response = await fetch('/api/v1/predictive-forecast', { cache: 'no-store' })
      let nextSource: 'live' | 'demo' = 'live'
      if (!response.ok) {
        response = await fetch('/api/v1/predictive-forecast/demo', { cache: 'no-store' })
        nextSource = 'demo'
      }
      if (!response.ok) throw new Error('Predictive forecast API unavailable')
      const payload = await response.json() as PredictiveForecastResponse
      setForecast(payload)
      setSource(nextSource)
      setError('')
    } catch {
      setError('Predictive forecasting is temporarily unavailable.')
    }
  }, [])

  useEffect(() => {
    void loadForecast()
  }, [loadForecast])

  useEffect(() => {
    if (selectedWorkstream !== 'All' && selectedWorkstream !== 'Operations') {
      setScenarioWorkstream(selectedWorkstream)
    }
  }, [selectedWorkstream])

  const months = useMemo(() => forecast?.months.slice(0, horizon) ?? [], [forecast, horizon])
  const selectedStreams = useMemo<ReportingScope[]>(
    () => selectedWorkstream === 'All' ? reportingWorkstreams : [selectedWorkstream],
    [selectedWorkstream],
  )
  const summaries = useMemo(
    (): Array<PredictiveWorkstreamSummary | PredictiveProgrammeSummary> => {
      if (!forecast) return []
      if (isProgrammeFilter(selectedWorkstream)) {
        return forecast.programme_summaries.filter(
          (row) => row.programme_code === selectedWorkstream,
        )
      }
      return forecast.workstream_summaries.filter(
        (row) => selectedStreams.includes(row.workstream),
      )
    },
    [forecast, selectedStreams, selectedWorkstream],
  )
  const scenarioRows = useMemo(() => {
    if (!forecast) return []
    const workstreamRows = reportingWorkstreams.flatMap((workstream) => {
      const duration = forecast.workstream_summaries.find(
        (summary) => summary.workstream === workstream,
      )?.median_duration_months ?? 18
      return applyPredictiveScenario(
        forecast.workstream_months.filter((row) => row.workstream === workstream),
        duration,
        confidence,
        scenarioDrafts,
      )
    })
    const programmeRows = pharmacyProgrammeFilters.flatMap((programmeCode) => {
      const duration = forecast.programme_summaries.find(
        (summary) => summary.programme_code === programmeCode,
      )?.median_duration_months ?? 18
      return applyPredictiveScenario(
        forecast.programme_months.filter(
          (row) => row.programme_code === programmeCode,
        ),
        duration,
        confidence,
        scenarioDrafts,
      )
    })
    return [...workstreamRows, ...programmeRows]
  }, [confidence, forecast, scenarioDrafts])
  const scenarioRowsByKey = useMemo(
    () => new Map(scenarioRows.map((row) => [scenarioKey(row.scope, row.month), row])),
    [scenarioRows],
  )
  const scenarioCount = Object.values(scenarioDrafts).filter(draftHasValues).length
  const selectedScenarioCount = Object.entries(scenarioDrafts).filter(([key, draft]) => (
    draftHasValues(draft)
    && selectedStreams.some((scope) => key.startsWith(`${scope}:`))
  )).length
  const visibleScenarioRows = months.map(
    (month) => scenarioRowsByKey.get(scenarioKey(scenarioWorkstream, month)),
  ).filter((row): row is PredictiveScenarioRow => Boolean(row))

  const monthly = useMemo(() => months.map((month) => {
    const sourceRows = !forecast
      ? []
      : isProgrammeFilter(selectedWorkstream)
        ? forecast.programme_months.filter(
          (row) => row.month === month && row.programme_code === selectedWorkstream,
        )
        : forecast.workstream_months.filter(
          (row) => row.month === month && selectedStreams.includes(row.workstream),
        )
    const modeledRows = selectedStreams.map(
      (scope) => scenarioRowsByKey.get(scenarioKey(scope, month)),
    ).filter((row): row is PredictiveScenarioRow => Boolean(row))
    return {
      month,
      existing: sourceRows.reduce((sum, row) => sum + row.existing_active_learners, 0),
      finishes: sourceRows.reduce((sum, row) => sum + row.scheduled_finishes, 0),
      knownStarts: sourceRows.reduce((sum, row) => sum + row.known_pipeline_starts, 0),
      baselineStarts: modeledRows.reduce((sum, row) => sum + row.baselineStarts, 0),
      scenarioStarts: modeledRows.reduce((sum, row) => sum + row.effectiveStarters, 0),
      baselineActive: modeledRows.reduce((sum, row) => sum + row.baselineActive, 0),
      active: modeledRows.reduce((sum, row) => sum + row.revisedActive, 0),
      capacity: modeledRows.reduce((sum, row) => sum + row.effectiveCapacity, 0),
      tutors: modeledRows.reduce((sum, row) => sum + row.additionalTutors, 0),
      hasAdjustment: modeledRows.some((row) => row.hasAdjustment),
    }
  }), [forecast, months, scenarioRowsByKey, selectedStreams, selectedWorkstream])

  function updateScenarioField(
    workstream: ReportingScope,
    month: string,
    field: ScenarioField,
    value: string,
  ) {
    if (!/^\d*$/.test(value)) return
    const key = scenarioKey(workstream, month)
    setScenarioDrafts((current) => {
      const nextDraft = { ...current[key], [field]: value }
      if (!draftHasValues(nextDraft)) {
        const next = { ...current }
        delete next[key]
        return next
      }
      return { ...current, [key]: nextDraft }
    })
  }

  function resetScenarioRow(workstream: ReportingScope, month: string) {
    const key = scenarioKey(workstream, month)
    setScenarioDrafts((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function resetScenarioWorkstream(workstream: ReportingScope) {
    setScenarioDrafts((current) => Object.fromEntries(
      Object.entries(current).filter(([key]) => !key.startsWith(`${workstream}:`)),
    ))
  }

  if (error) {
    return <section className="predictive-state error"><h1>Predictive Forecasting</h1><p>{error}</p></section>
  }
  if (!forecast) {
    return <section className="predictive-state"><span className="predictive-loader" /><p>Building the historical forecast…</p></section>
  }

  const currentActive = summaries.reduce((sum, row) => sum + row.current_active_learners, 0)
  const capacity = summaries.reduce((sum, row) => sum + row.effective_capacity, 0)
  const peakRow = monthly.reduce(
    (peak, row) => row.active > peak.active ? row : peak,
    monthly[0] ?? { month: '', active: 0, tutors: 0 },
  )
  const peakTutors = Math.max(...monthly.map((row) => row.tutors), 0)
  const firstShortage = monthly.find((row) => row.tutors > 0)
  const chartMax = Math.max(...monthly.flatMap((row) => [row.active, row.capacity]), 1)
  const invalidRows = visibleScenarioRows.filter((row) => row.invalidExitAmount > 0)
  const bilWarningRows = visibleScenarioRows.filter(
    (row) => row.bilReturns > 0 && row.bilReturnExceedsScenarioBreaks,
  )

  function workstreamScenario(summary: PredictiveWorkstreamSummary | PredictiveProgrammeSummary) {
    const scope = (
      'programme_code' in summary ? summary.programme_code : summary.workstream
    ) as ReportingScope
    const rows = months.map(
      (month) => scenarioRowsByKey.get(scenarioKey(scope, month)),
    ).filter((row): row is PredictiveScenarioRow => Boolean(row))
    return {
      peakActive: Math.max(...rows.map((row) => row.revisedActive), 0),
      peakTutors: Math.max(...rows.map((row) => row.additionalTutors), 0),
    }
  }

  return (
    <>
      <header className="topbar predictive-topbar">
        <div>
          <p className="eyebrow">Historical demand model</p>
          <h1>Predictive Forecasting</h1>
          <p className="page-intro">Estimate learner demand and the month additional tutors may be required.</p>
        </div>
        <div className="predictive-filters">
          <label><span>Workstream / programme</span><select value={selectedWorkstream} onChange={(event) => onWorkstreamChange(event.target.value as ReportingFilter)}>{reportingFilterOptions.map((filter) => <option key={filter} value={filter}>{reportingFilterLabels[filter]}</option>)}</select></label>
          <label><span>Planning range</span><select value={confidence} onChange={(event) => setConfidence(event.target.value as PredictiveConfidence)}><option value="p50">P50 — expected</option><option value="p80">P80 — prudent</option><option value="p90">P90 — cautious</option></select></label>
          <label><span>Horizon</span><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as 6 | 12 | 18)}><option value={6}>6 months</option><option value={12}>12 months</option><option value={18}>18 months</option></select></label>
          <button className={`predictive-scenario-toggle ${scenarioOpen ? 'active' : ''}`} onClick={() => setScenarioOpen((open) => !open)}><span>{scenarioOpen ? 'Hide inputs' : 'Model scenario'}</span><small>{scenarioCount ? `${scenarioCount} adjusted month${scenarioCount === 1 ? '' : 's'}` : 'Manual monthly movements'}</small></button>
        </div>
      </header>

      <section className="predictive-method" aria-label="Forecast methodology">
        <div><span className={`source-pill ${source}`}>{source === 'live' ? 'Live Attendance data' : 'Demonstration data'}</span><strong>{confidenceCopy[confidence].label}</strong>{selectedScenarioCount > 0 && <span className="scenario-live-pill">Scenario applied</span>}<p>{confidenceCopy[confidence].description}. {forecast.method_description}</p></div>
        <dl><div><dt>Training period</dt><dd>{formatMonth(forecast.training_start)}–{formatMonth(forecast.training_end)}</dd></div><div><dt>Generated</dt><dd>{formatDate(forecast.generated_at)}</dd></div></dl>
      </section>

      {source === 'live' && <ProgrammePlanningPanel onSaved={loadForecast} />}

      {scenarioOpen && (
        <section className="predictive-scenario-card" aria-labelledby="predictive-scenario-title">
          <div className="predictive-scenario-heading">
            <div><p className="eyebrow">Manual planning layer</p><h2 id="predictive-scenario-title">Monthly learner movements</h2><p>Blank Starters use the {confidence.toUpperCase()} model; entering zero is an explicit override. Net movement = Starters + BiL returns − BiL − WD − OOF.</p></div>
            <div className="predictive-scenario-actions">
              <label><span>Editing workstream / programme</span><select value={scenarioWorkstream} onChange={(event) => setScenarioWorkstream(event.target.value as ReportingScope)}>{reportingScopeOptions.map((scope) => <option key={scope} value={scope}>{reportingFilterLabels[scope]}</option>)}</select></label>
              <button onClick={() => resetScenarioWorkstream(scenarioWorkstream)} disabled={!Object.entries(scenarioDrafts).some(([key, draft]) => key.startsWith(`${scenarioWorkstream}:`) && draftHasValues(draft))}>Reset {reportingFilterLabels[scenarioWorkstream]}</button>
              <button onClick={() => setScenarioDrafts({})} disabled={!scenarioCount}>Reset all</button>
            </div>
          </div>
          {(invalidRows.length > 0 || bilWarningRows.length > 0) && (
            <div className="predictive-scenario-alerts" role="alert">
              {invalidRows.length > 0 && <p className="error">Some exits exceed the available forecast population. Those rows are capped at zero and highlighted below.</p>}
              {bilWarningRows.length > 0 && <p>A BiL return exceeds breaks entered in this scenario; it is allowed because the break may pre-date the forecast.</p>}
            </div>
          )}
          <div className="predictive-scenario-table-wrap">
            <table className="predictive-scenario-table">
              <thead><tr><th>Month</th><th>Model starts</th>{scenarioFields.map(({ field, shortLabel }) => <th key={field} title={scenarioFields.find((item) => item.field === field)?.label}>{shortLabel}</th>)}<th>Net movement</th><th>Revised active</th><th>Tutors</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{visibleScenarioRows.map((row) => { const key = scenarioKey(row.scope, row.month); const draft = scenarioDrafts[key]; return <tr key={row.month} className={`${row.hasAdjustment ? 'adjusted' : ''} ${row.invalidExitAmount > 0 ? 'invalid' : ''}`}><td><strong>{formatMonth(row.month)}</strong>{row.invalidExitAmount > 0 && <small>Exceeds by {row.invalidExitAmount}</small>}{row.bilReturns > 0 && row.bilReturnExceedsScenarioBreaks && <small className="warning">Pre-horizon return?</small>}</td><td><strong>{row.baselineStarts}</strong><small>{confidence.toUpperCase()}</small></td>{scenarioFields.map(({ field, label }) => <td key={field}><input aria-label={`${label} for ${reportingFilterLabels[row.scope]} in ${formatMonth(row.month)}`} inputMode="numeric" min="0" step="1" type="number" value={draft?.[field] ?? ''} placeholder={field === 'starters' ? `${row.baselineStarts}` : '0'} onChange={(event) => updateScenarioField(row.scope, row.month, field, event.target.value)} /></td>)}<td><strong className={row.netMovement < 0 ? 'negative' : 'positive'}>{signed(row.netMovement)}</strong></td><td><strong>{row.revisedActive}</strong><small className={row.variance === 0 ? '' : row.variance < 0 ? 'negative' : 'positive'}>{row.variance === 0 ? 'baseline' : `${signed(row.variance)} vs model`}</small></td><td><span className={`resource-status ${row.additionalTutors > 0 ? 'gap' : 'covered'}`}>{row.additionalTutors > 0 ? `${row.additionalTutors} required` : 'Covered'}</span></td><td><button className="scenario-row-reset" onClick={() => resetScenarioRow(row.scope, row.month)} disabled={!row.hasAdjustment}>Clear</button></td></tr> })}</tbody>
            </table>
          </div>
          <p className="predictive-scenario-footnote">Scenario entries are kept only in this browser session. They do not update Attendance or the Capacity database.</p>
        </section>
      )}

      <section className="forecast-summary-grid predictive-summary" aria-label="Predictive forecast summary">
        <article><span>Current active learners</span><strong>{currentActive.toLocaleString('en-GB')}</strong><small>{reportingFilterLabels[selectedWorkstream]}</small></article>
        <article><span>Effective tutor capacity</span><strong>{capacity.toLocaleString('en-GB')}</strong><small>Operations excluded</small></article>
        <article><span>{selectedScenarioCount ? 'Peak scenario learners' : 'Peak predicted learners'}</span><strong>{peakRow.active.toLocaleString('en-GB')}</strong><small>{peakRow.month ? formatMonth(peakRow.month) : 'No forecast months'}</small></article>
        <article className={peakTutors > 0 ? 'attention' : ''}><span>Additional tutors at peak</span><strong>{peakTutors}</strong><small>{firstShortage ? `first needed ${formatMonth(firstShortage.month)}` : 'current team covers forecast'}</small></article>
      </section>

      <section className="predictive-chart-card">
        <div className="section-heading"><div><p className="eyebrow">Demand against available places</p><h2>{selectedScenarioCount ? 'Scenario active learner load' : 'Predicted active learner load'}</h2></div><div className="legend"><span className="capacity-key">Capacity</span><span className="predictive-demand-key">{selectedScenarioCount ? 'Scenario' : confidence.toUpperCase()} active learners</span></div></div>
        <div className="predictive-chart" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(46px, 1fr))` }}>
          {monthly.map((row) => <div className={`predictive-chart-column ${row.hasAdjustment ? 'adjusted' : ''}`} key={row.month}><div className="predictive-chart-value">{row.active}</div><div className="predictive-bar-area"><span className="predictive-capacity-bar" style={{ height: `${(row.capacity / chartMax) * 100}%` }} /><span className={`predictive-demand-bar ${row.active > row.capacity ? 'over' : ''}`} style={{ height: `${(row.active / chartMax) * 100}%` }} /></div><small>{formatMonth(row.month)}</small></div>)}
        </div>
      </section>

      <section className="predictive-workstreams">
        <div className="section-heading"><div><p className="eyebrow">Evidence by workstream</p><h2>Model confidence and peak requirement</h2></div></div>
        <div className="predictive-workstream-grid">
          {summaries.map((row) => { const scenario = workstreamScenario(row); const scope = 'programme_code' in row ? row.programme_code : row.workstream; const label = 'programme_name' in row ? row.programme_name : row.workstream; return <article key={scope} data-stream={row.workstream}><div><h3>{label}</h3><span className={`confidence-pill ${row.data_confidence.toLowerCase()}`}>{row.data_confidence} confidence</span></div><dl><div><dt>Historical starts</dt><dd>{row.historical_starts}</dd></div><div><dt>History used</dt><dd>{row.historical_months} months</dd></div><div><dt>Typical duration</dt><dd>{row.median_duration_months} months</dd></div><div><dt>Peak learners</dt><dd>{scenario.peakActive}</dd></div></dl><p>{scenario.peakTutors > 0 ? `${scenario.peakTutors} additional tutor${scenario.peakTutors > 1 ? 's' : ''} at peak` : 'Current capacity covers the predicted peak'}</p></article> })}
        </div>
      </section>

      <section className="resource-table-card predictive-table-card">
        <div className="section-heading"><div><p className="eyebrow">Numerical forecast</p><h2>Monthly demand and staffing requirement</h2></div></div>
        <div className="resource-table-wrap"><table className="resource-table predictive-table"><thead><tr><th>Month</th><th>Existing</th><th title="Existing learners whose planned end date falls within this month">Learners finishing</th><th>Known pipeline</th><th>Model starts</th><th>Scenario starts</th><th>Baseline active</th><th>Revised active</th><th>Capacity</th><th>Variance</th><th>Additional tutors</th></tr></thead><tbody>{monthly.map((row) => <tr key={row.month} className={row.hasAdjustment ? 'scenario-adjusted-row' : ''}><td><strong>{formatMonth(row.month)}</strong></td><td>{row.existing}</td><td>{row.finishes}</td><td>{row.knownStarts}</td><td>{row.baselineStarts}</td><td><strong>{row.scenarioStarts}</strong></td><td>{row.baselineActive}</td><td><strong>{row.active}</strong></td><td>{row.capacity}</td><td className={row.active - row.baselineActive < 0 ? 'negative' : row.active - row.baselineActive > 0 ? 'positive' : ''}>{signed(row.active - row.baselineActive)}</td><td><span className={`resource-status ${row.tutors > 0 ? 'gap' : 'covered'}`}>{row.tutors > 0 ? `${row.tutors} required` : 'Covered'}</span></td></tr>)}</tbody></table></div>
      </section>

      <details className="predictive-warnings"><summary>Data quality notes ({forecast.data_warnings.length})</summary><ul>{forecast.data_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
    </>
  )
}

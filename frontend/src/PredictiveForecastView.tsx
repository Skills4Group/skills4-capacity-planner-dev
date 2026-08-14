import { useEffect, useMemo, useState } from 'react'
import {
  reportingWorkstreams,
  type PredictiveConfidence,
  type PredictiveForecastResponse,
  type PredictiveWorkstreamMonth,
  type PredictiveWorkstreamSummary,
  type Workstream,
} from './types'

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

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatDate(value: string) {
  return fullDateFormatter.format(new Date(`${value}T00:00:00Z`))
}

function predictedStarts(row: PredictiveWorkstreamMonth, confidence: PredictiveConfidence) {
  if (confidence === 'p50') return row.predicted_starts_p50
  if (confidence === 'p80') return row.predicted_starts_p80
  return row.predicted_starts_p90
}

function predictedActive(row: PredictiveWorkstreamMonth, confidence: PredictiveConfidence) {
  if (confidence === 'p50') return row.predicted_active_p50
  if (confidence === 'p80') return row.predicted_active_p80
  return row.predicted_active_p90
}

function additionalTutors(row: PredictiveWorkstreamMonth, confidence: PredictiveConfidence) {
  if (confidence === 'p50') return row.additional_tutors_p50
  if (confidence === 'p80') return row.additional_tutors_p80
  return row.additional_tutors_p90
}

function summaryPeak(summary: PredictiveWorkstreamSummary, confidence: PredictiveConfidence) {
  if (confidence === 'p50') return summary.peak_active_p50
  if (confidence === 'p80') return summary.peak_active_p80
  return summary.peak_active_p90
}

function summaryTutors(summary: PredictiveWorkstreamSummary, confidence: PredictiveConfidence) {
  if (confidence === 'p50') return summary.peak_additional_tutors_p50
  if (confidence === 'p80') return summary.peak_additional_tutors_p80
  return summary.peak_additional_tutors_p90
}

interface PredictiveForecastViewProps {
  selectedWorkstream: Workstream | 'All'
  onWorkstreamChange: (workstream: Workstream | 'All') => void
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

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        let response = await fetch('/api/v1/predictive-forecast')
        let nextSource: 'live' | 'demo' = 'live'
        if (!response.ok) {
          response = await fetch('/api/v1/predictive-forecast/demo')
          nextSource = 'demo'
        }
        if (!response.ok) throw new Error('Predictive forecast API unavailable')
        const payload = await response.json() as PredictiveForecastResponse
        if (!cancelled) {
          setForecast(payload)
          setSource(nextSource)
          setError('')
        }
      } catch {
        if (!cancelled) setError('Predictive forecasting is temporarily unavailable.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const months = useMemo(() => forecast?.months.slice(0, horizon) ?? [], [forecast, horizon])
  const selectedStreams = useMemo(
    () => reportingWorkstreams.filter(
      (workstream) => selectedWorkstream === 'All' || workstream === selectedWorkstream,
    ),
    [selectedWorkstream],
  )
  const summaries = useMemo(
    () => forecast?.workstream_summaries.filter((row) => selectedStreams.includes(row.workstream)) ?? [],
    [forecast, selectedStreams],
  )
  const monthly = useMemo(() => months.map((month) => {
    const rows = forecast?.workstream_months.filter(
      (row) => row.month === month && selectedStreams.includes(row.workstream),
    ) ?? []
    return {
      month,
      existing: rows.reduce((sum, row) => sum + row.existing_active_learners, 0),
      knownStarts: rows.reduce((sum, row) => sum + row.known_pipeline_starts, 0),
      predictedStarts: rows.reduce((sum, row) => sum + predictedStarts(row, confidence), 0),
      active: rows.reduce((sum, row) => sum + predictedActive(row, confidence), 0),
      capacity: rows.reduce((sum, row) => sum + row.effective_capacity, 0),
      tutors: rows.reduce((sum, row) => sum + additionalTutors(row, confidence), 0),
    }
  }), [confidence, forecast, months, selectedStreams])

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

  return (
    <>
      <header className="topbar predictive-topbar">
        <div>
          <p className="eyebrow">Historical demand model</p>
          <h1>Predictive Forecasting</h1>
          <p className="page-intro">Estimate learner demand and the month additional tutors may be required.</p>
        </div>
        <div className="predictive-filters">
          <label><span>Workstream</span><select value={selectedWorkstream} onChange={(event) => onWorkstreamChange(event.target.value as Workstream | 'All')}><option value="All">All workstreams</option>{reportingWorkstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}</select></label>
          <label><span>Planning range</span><select value={confidence} onChange={(event) => setConfidence(event.target.value as PredictiveConfidence)}><option value="p50">P50 — expected</option><option value="p80">P80 — prudent</option><option value="p90">P90 — cautious</option></select></label>
          <label><span>Horizon</span><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as 6 | 12 | 18)}><option value={6}>6 months</option><option value={12}>12 months</option><option value={18}>18 months</option></select></label>
        </div>
      </header>

      <section className="predictive-method" aria-label="Forecast methodology">
        <div><span className={`source-pill ${source}`}>{source === 'live' ? 'Live Attendance data' : 'Demonstration data'}</span><strong>{confidenceCopy[confidence].label}</strong><p>{confidenceCopy[confidence].description}. {forecast.method_description}</p></div>
        <dl><div><dt>Training period</dt><dd>{formatMonth(forecast.training_start)}–{formatMonth(forecast.training_end)}</dd></div><div><dt>Generated</dt><dd>{formatDate(forecast.generated_at)}</dd></div></dl>
      </section>

      <section className="forecast-summary-grid predictive-summary" aria-label="Predictive forecast summary">
        <article><span>Current active learners</span><strong>{currentActive.toLocaleString('en-GB')}</strong><small>{selectedWorkstream === 'All' ? 'reporting workstreams' : selectedWorkstream}</small></article>
        <article><span>Effective tutor capacity</span><strong>{capacity.toLocaleString('en-GB')}</strong><small>Operations excluded</small></article>
        <article><span>Peak predicted learners</span><strong>{peakRow.active.toLocaleString('en-GB')}</strong><small>{peakRow.month ? formatMonth(peakRow.month) : 'No forecast months'}</small></article>
        <article className={peakTutors > 0 ? 'attention' : ''}><span>Additional tutors at peak</span><strong>{peakTutors}</strong><small>{firstShortage ? `first needed ${formatMonth(firstShortage.month)}` : 'current team covers forecast'}</small></article>
      </section>

      <section className="predictive-chart-card">
        <div className="section-heading"><div><p className="eyebrow">Demand against available places</p><h2>Predicted active learner load</h2></div><div className="legend"><span className="capacity-key">Capacity</span><span className="predictive-demand-key">{confidence.toUpperCase()} active learners</span></div></div>
        <div className="predictive-chart" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(46px, 1fr))` }}>
          {monthly.map((row) => <div className="predictive-chart-column" key={row.month}><div className="predictive-chart-value">{row.active}</div><div className="predictive-bar-area"><span className="predictive-capacity-bar" style={{ height: `${(row.capacity / chartMax) * 100}%` }} /><span className={`predictive-demand-bar ${row.active > row.capacity ? 'over' : ''}`} style={{ height: `${(row.active / chartMax) * 100}%` }} /></div><small>{formatMonth(row.month)}</small></div>)}
        </div>
      </section>

      <section className="predictive-workstreams">
        <div className="section-heading"><div><p className="eyebrow">Evidence by workstream</p><h2>Model confidence and peak requirement</h2></div></div>
        <div className="predictive-workstream-grid">
          {summaries.map((row) => <article key={row.workstream} data-stream={row.workstream}><div><h3>{row.workstream}</h3><span className={`confidence-pill ${row.data_confidence.toLowerCase()}`}>{row.data_confidence} confidence</span></div><dl><div><dt>Historical starts</dt><dd>{row.historical_starts}</dd></div><div><dt>History used</dt><dd>{row.historical_months} months</dd></div><div><dt>Typical duration</dt><dd>{row.median_duration_months} months</dd></div><div><dt>Peak learners</dt><dd>{summaryPeak(row, confidence)}</dd></div></dl><p>{summaryTutors(row, confidence) > 0 ? `${summaryTutors(row, confidence)} additional tutor${summaryTutors(row, confidence) > 1 ? 's' : ''} at peak` : 'Current capacity covers the predicted peak'}</p></article>)}
        </div>
      </section>

      <section className="resource-table-card predictive-table-card">
        <div className="section-heading"><div><p className="eyebrow">Numerical forecast</p><h2>Monthly demand and staffing requirement</h2></div></div>
        <div className="resource-table-wrap"><table className="resource-table predictive-table"><thead><tr><th>Month</th><th>Existing learners</th><th>Known pipeline</th><th>Predicted starts</th><th>Predicted active</th><th>Capacity</th><th>Gap</th><th>Additional tutors</th></tr></thead><tbody>{monthly.map((row) => { const gap = row.capacity - row.active; return <tr key={row.month}><td><strong>{formatMonth(row.month)}</strong></td><td>{row.existing}</td><td>{row.knownStarts}</td><td>{row.predictedStarts}</td><td><strong>{row.active}</strong></td><td>{row.capacity}</td><td className={gap < 0 ? 'negative' : 'positive'}>{gap > 0 ? `+${gap}` : gap}</td><td><span className={`resource-status ${row.tutors > 0 ? 'gap' : 'covered'}`}>{row.tutors > 0 ? `${row.tutors} required` : 'Covered'}</span></td></tr> })}</tbody></table></div>
      </section>

      <details className="predictive-warnings"><summary>Data quality notes ({forecast.data_warnings.length})</summary><ul>{forecast.data_warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></details>
    </>
  )
}

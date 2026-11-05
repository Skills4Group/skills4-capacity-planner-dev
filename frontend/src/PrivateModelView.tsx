import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ForecastResponse,
  PrivateModelAccessResponse,
  PrivateModelAssumptions,
  PrivateModelDirectoryResponse,
  PredictiveForecastResponse,
} from './types'
import { buildPrivateModel } from './privateModel'

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})
const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
const currencyFormatter = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 })

function formatMonth(value: string) {
  return monthFormatter.format(new Date(`${value}T00:00:00Z`))
}

function formatMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : currencyFormatter.format(value)
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00Z`))
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { detail?: string }
    return payload.detail || fallback
  } catch {
    return fallback
  }
}

export function PrivateModelView({ access }: { access: PrivateModelAccessResponse }) {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null)
  const [predictive, setPredictive] = useState<PredictiveForecastResponse | null>(null)
  const [savedAssumptions, setSavedAssumptions] = useState<PrivateModelAssumptions | null>(null)
  const [draft, setDraft] = useState<PrivateModelAssumptions | null>(null)
  const [directory, setDirectory] = useState<PrivateModelDirectoryResponse | null>(null)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadDirectory = useCallback(async () => {
    const response = await fetch('/api/v1/private-model/users', { cache: 'no-store' })
    if (!response.ok) throw new Error(await responseError(response, 'Access list could not be loaded'))
    setDirectory(await response.json() as PrivateModelDirectoryResponse)
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const responses = await Promise.all([
          fetch('/api/v1/private-model/forecast', { cache: 'no-store' }),
          fetch('/api/v1/private-model/predictive-forecast', { cache: 'no-store' }),
          fetch('/api/v1/private-model/assumptions', { cache: 'no-store' }),
        ])
        for (const response of responses) {
          if (!response.ok) throw new Error(await responseError(response, 'Private model data could not be loaded'))
        }
        const [payload, predictivePayload, assumptionsPayload] = await Promise.all([
          responses[0].json() as Promise<ForecastResponse>,
          responses[1].json() as Promise<PredictiveForecastResponse>,
          responses[2].json() as Promise<PrivateModelAssumptions>,
        ])
        if (!active) return
        setForecast(payload)
        setPredictive(predictivePayload)
        setSavedAssumptions(assumptionsPayload)
        setDraft(assumptionsPayload)
        if (access.is_owner) await loadDirectory()
        if (active) setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Private model is unavailable')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [access.is_owner, loadDirectory])

  const availableUsers = useMemo(() => {
    const granted = new Set(directory?.grants.map((grant) => grant.object_id.toLowerCase()) ?? [])
    return directory?.registered_users.filter((user) => (
      user.object_id.toLowerCase() !== directory.owner_object_id.toLowerCase()
      && !granted.has(user.object_id.toLowerCase())
    )) ?? []
  }, [directory])

  const model = useMemo(() => (
    forecast && predictive && draft ? buildPrivateModel(predictive, forecast, draft) : []
  ), [forecast, predictive, draft])
  const finalMonth = model.at(-1)
  const scenarioCashIn = model.every((row) => row.scenarioCashIn !== null)
    ? model.reduce((total, row) => total + (row.scenarioCashIn ?? 0), 0) : null
  const scenarioPayroll = model.every((row) => row.scenarioPayroll !== null)
    ? model.reduce((total, row) => total + (row.scenarioPayroll ?? 0), 0) : null
  const marginChange = finalMonth?.cumulativeScenarioMargin === null || finalMonth?.cumulativeBaselineMargin === null || !finalMonth
    ? null : finalMonth.cumulativeScenarioMargin - finalMonth.cumulativeBaselineMargin
  const hasUnsavedChanges = Boolean(draft && savedAssumptions && (
    draft.effective_month !== savedAssumptions.effective_month
    || draft.cohort_size !== savedAssumptions.cohort_size
    || draft.monthly_tutor_cost !== savedAssumptions.monthly_tutor_cost
    || draft.average_contract_value !== savedAssumptions.average_contract_value
    || draft.enrolment_drop_percent !== savedAssumptions.enrolment_drop_percent
  ))

  async function saveAssumptions() {
    if (!draft || !access.is_owner) return
    setSavingId('assumptions')
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/v1/private-model/assumptions', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effective_month: draft.effective_month,
          cohort_size: draft.cohort_size,
          monthly_tutor_cost: draft.monthly_tutor_cost,
          average_contract_value: draft.average_contract_value,
          enrolment_drop_percent: draft.enrolment_drop_percent,
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Assumptions could not be saved'))
      const saved = await response.json() as PrivateModelAssumptions
      setSavedAssumptions(saved)
      setDraft(saved)
      setMessage('Private model assumptions saved for everyone with access.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Assumptions could not be saved')
    } finally {
      setSavingId(null)
    }
  }

  async function grantAccess() {
    if (!selectedUserId || !access.is_owner) return
    const user = availableUsers.find((item) => item.object_id === selectedUserId)
    if (!user) return
    setSavingId(selectedUserId)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/v1/private-model/users/${encodeURIComponent(selectedUserId)}`, {
        method: 'PUT',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Access could not be granted'))
      await loadDirectory()
      setSelectedUserId('')
      setMessage(`${user.display_name} can now open the private model.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Access could not be granted')
    } finally {
      setSavingId(null)
    }
  }

  async function revokeAccess(objectId: string, name: string) {
    if (!access.is_owner || !window.confirm(`Remove private model access for ${name}?`)) return
    setSavingId(objectId)
    setMessage('')
    setError('')
    try {
      const response = await fetch(`/api/v1/private-model/users/${encodeURIComponent(objectId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Access could not be removed'))
      await loadDirectory()
      setMessage(`${name} no longer has private model access.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Access could not be removed')
    } finally {
      setSavingId(null)
    }
  }

  if (!access.can_view) return null

  return <>
    <header className="topbar">
      <div><p className="eyebrow">Restricted workspace</p><h1>Private Model</h1><p className="page-intro">A separate model workspace using live Capacity Tracker data.</p></div>
      <div className="admin-identity"><span>{access.is_owner ? 'Model owner' : 'Authorised access'}</span><strong>Entra protected</strong></div>
    </header>

    {loading && <section className="private-model-card"><p>Loading private model data…</p></section>}
    {error && <div className="tutor-message error" role="alert">{error}</div>}
    {message && <div className="tutor-message success" role="status">{message}</div>}

    {forecast && <>
      <section className="private-model-card">
        <p className="eyebrow">Shared data foundation</p>
        <h2>Current Capacity snapshot</h2>
        <p>This tab reads the same live forecast source as the Capacity report. We can define and build the new model here without changing the current calculations.</p>
        <div className="private-model-metrics">
          <div><span>Current learners</span><strong>{forecast.current_total_snapshot?.learners.toLocaleString('en-GB') ?? '—'}</strong></div>
          <div><span>Available tutor places</span><strong>{forecast.current_total_snapshot?.remaining_places.toLocaleString('en-GB') ?? '—'}</strong></div>
          <div><span>Reporting workstreams</span><strong>{forecast.current_workstream_snapshots?.length ?? 0}</strong></div>
          <div><span>Data generated</span><strong>{formatDate(forecast.generated_at)}</strong></div>
        </div>
      </section>
    </>}

    {draft && predictive && <>
      <section className="private-model-card">
        <p className="eyebrow">Worst-case enrolment scenario</p>
        <h2>Model levers</h2>
        <p>From the selected month, reduce all forecast new starts by the chosen percentage. Existing learners remain until their forecast exit. Changes preview immediately; only the model owner can save the shared assumptions.</p>
        <div className="private-model-controls">
          <label><span>Scenario begins</span><select value={draft.effective_month} onChange={(event) => setDraft({ ...draft, effective_month: event.target.value })}>{!predictive.months.includes(draft.effective_month) && <option value={draft.effective_month}>{formatMonth(draft.effective_month)}</option>}{predictive.months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label>
          <label><span>New-start drop (%)</span><input type="number" min="0" max="100" step="1" value={draft.enrolment_drop_percent} onChange={(event) => setDraft({ ...draft, enrolment_drop_percent: Math.min(100, Math.max(0, Number(event.target.value))) })} /></label>
          <label><span>Target cohort size</span><input type="number" min="1" max="250" step="1" value={draft.cohort_size} onChange={(event) => setDraft({ ...draft, cohort_size: Math.min(250, Math.max(1, Math.round(Number(event.target.value) || 1))) })} /></label>
          <label><span>Contract value per starter (£)</span><input type="number" min="0" max="1000000" step="0.01" value={draft.average_contract_value ?? ''} placeholder="Enter amount" onChange={(event) => setDraft({ ...draft, average_contract_value: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} /></label>
          <label><span>Monthly tutor cost (£)</span><input type="number" min="0" max="1000000" step="0.01" value={draft.monthly_tutor_cost ?? ''} placeholder="Enter amount" onChange={(event) => setDraft({ ...draft, monthly_tutor_cost: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} /></label>
        </div>
        <div className="private-model-actions">
          {access.is_owner && <button className="settings-primary-button" type="button" disabled={!hasUnsavedChanges || savingId !== null} onClick={() => void saveAssumptions()}>{savingId === 'assumptions' ? 'Saving…' : 'Save shared assumptions'}</button>}
          {hasUnsavedChanges && <span>Previewing unsaved changes</span>}
          {!hasUnsavedChanges && savedAssumptions?.updated_at && <span>Shared assumptions saved {new Date(savedAssumptions.updated_at).toLocaleDateString('en-GB')}</span>}
        </div>
      </section>

      <section className="private-model-card">
        <p className="eyebrow">18-month scenario outlook · P80 prudent forecast</p>
        <h2>Demand, staffing and cash margin</h2>
        <div className="private-model-metrics private-model-impact-metrics">
          <div><span>Scenario cash in</span><strong>{formatMoney(scenarioCashIn)}</strong></div>
          <div><span>Scenario tutor payroll</span><strong>{formatMoney(scenarioPayroll)}</strong></div>
          <div><span>Cumulative cash margin</span><strong>{formatMoney(finalMonth?.cumulativeScenarioMargin)}</strong></div>
          <div><span>Last-month tutors required</span><strong>{finalMonth?.scenarioTutorsRequired.toLocaleString('en-GB') ?? '—'}</strong></div>
          <div><span>Margin change vs baseline</span><strong className={marginChange !== null && marginChange < 0 ? 'private-model-negative' : ''}>{marginChange === null ? '—' : `${marginChange > 0 ? '+' : ''}${currencyFormatter.format(marginChange)}`}</strong></div>
        </div>
        {(draft.average_contract_value === null || draft.monthly_tutor_cost === null) && <p className="private-model-note">Enter contract value and monthly tutor cost to see the cash results.</p>}
        <div className="private-model-chart" role="img" aria-label="Baseline and scenario active learners by month">
          {model.map((row) => <div className="private-model-chart-row" key={row.month}>
            <span>{formatMonth(row.month)}</span>
            <div className="private-model-chart-track"><i style={{ width: `${row.baselineActive / Math.max(1, ...model.map((item) => item.baselineActive)) * 100}%` }} /><b style={{ width: `${row.scenarioActive / Math.max(1, ...model.map((item) => item.baselineActive)) * 100}%` }} /></div>
            <strong>{row.scenarioActive.toLocaleString('en-GB')}</strong>
          </div>)}
        </div>
        <div className="private-model-legend"><span className="private-model-legend-baseline">Baseline learners</span><span className="private-model-legend-scenario">Scenario learners</span></div>
      </section>

      <section className="private-model-card">
        <p className="eyebrow">Monthly detail</p><h2>Baseline versus scenario</h2>
        <p>The baseline is the unshocked P80 forecast at a 50-learner target, not actual payroll. Required tutors are rounded within each workstream. Available tutors are distinct people in the Capacity forecast; cross-workstream teaching is not jointly optimised in this first version.</p>
        <div className="private-model-table-wrap"><table className="private-model-table"><thead><tr><th>Month</th><th>Starts<br />base → scenario</th><th>Active learners<br />base → scenario</th><th>Tutors required<br />base → scenario</th><th>Available<br />tutors</th><th>Hire / surplus</th><th>Cash in<br />base → scenario</th><th>Tutor payroll<br />base → scenario</th><th>Cash margin<br />base → scenario</th><th>Cumulative margin<br />base → scenario</th></tr></thead><tbody>
          {model.map((row) => <tr key={row.month}><th scope="row">{formatMonth(row.month)}</th><td>{row.baselineStarts} → <strong>{row.scenarioStarts}</strong></td><td>{row.baselineActive} → <strong>{row.scenarioActive}</strong></td><td>{row.baselineTutorsRequired} → <strong>{row.scenarioTutorsRequired}</strong></td><td>{row.availableTutors}</td><td>{row.additionalTutors ? `${row.additionalTutors} hire` : row.potentialSurplus ? `${row.potentialSurplus} potential surplus` : 'Balanced'}</td><td>{formatMoney(row.baselineCashIn)} → <strong>{formatMoney(row.scenarioCashIn)}</strong></td><td>{formatMoney(row.baselinePayroll)} → <strong>{formatMoney(row.scenarioPayroll)}</strong></td><td className={row.scenarioMargin !== null && row.scenarioMargin < 0 ? 'private-model-negative' : ''}>{formatMoney(row.baselineMargin)} → <strong>{formatMoney(row.scenarioMargin)}</strong></td><td className={row.cumulativeScenarioMargin !== null && row.cumulativeScenarioMargin < 0 ? 'private-model-negative' : ''}>{formatMoney(row.cumulativeBaselineMargin)} → <strong>{formatMoney(row.cumulativeScenarioMargin)}</strong></td></tr>)}
        </tbody></table></div>
        <p className="private-model-note">Cash in assumes the full contract value is collected in the start month. Cash already collected for existing learners before this forecast is not included, although their tutor cost is; absolute margin is therefore not accounting profit. Payroll assumes staffing adjusts to the modelled requirement immediately. The scenario uses workstream-average durations, so individual future starters may finish at different dates. Technology, overhead, collection risk and other costs are not included.</p>
      </section>
    </>}

    {access.is_owner && <section className="private-model-card">
      <p className="eyebrow">Owner-only control</p>
      <h2>Private model access</h2>
      <p>Only you can grant or remove access. A person appears here after signing in to Capacity Tracker once; Capacity administrators are not included automatically.</p>
      <div className="private-model-grant-form">
        <label><span>Registered user</span><select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}><option value="">{availableUsers.length ? 'Select a user' : 'No users available'}</option>{availableUsers.map((user) => <option key={user.object_id} value={user.object_id}>{user.display_name}{user.email ? ` — ${user.email}` : ''}</option>)}</select></label>
        <button className="settings-primary-button" type="button" disabled={!selectedUserId || savingId !== null} onClick={() => void grantAccess()}>{savingId === selectedUserId && savingId ? 'Granting…' : 'Grant access'}</button>
      </div>
      <div className="private-model-grants">
        <h3>People with access</h3>
        {!directory && <p>Loading access list…</p>}
        {directory?.grants.length === 0 && <p>Only you can see this tab.</p>}
        {directory?.grants.map((grant) => <div className="private-model-grant" key={grant.object_id}><div><strong>{grant.display_name}</strong><small>{grant.email ?? 'No email recorded'}</small></div><button className="settings-remove-button" type="button" disabled={savingId !== null} onClick={() => void revokeAccess(grant.object_id, grant.display_name)}>{savingId === grant.object_id ? 'Removing…' : 'Remove'}</button></div>)}
      </div>
    </section>}
  </>
}

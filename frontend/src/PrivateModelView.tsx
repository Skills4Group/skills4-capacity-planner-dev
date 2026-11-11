import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ForecastResponse,
  PrivateModelAccessResponse,
  PrivateModelAssumptions,
  PrivateModelDirectoryResponse,
  PredictiveForecastResponse,
} from './types'
import { buildPrivateModel, privateModelCurrentSnapshot, selectedPrivateModelProgrammes, type PrivateModelScope } from './privateModel'

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
  const [scope, setScope] = useState<PrivateModelScope>('both')
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

  const selectedProgrammes = selectedPrivateModelProgrammes(scope)
  const programmeDataAvailable = Boolean(predictive && selectedProgrammes.every((code) => (
    predictive.months.every((month) => predictive.programme_months.some((row) => row.programme_code === code && row.month === month))
  )))
  const currentSnapshot = forecast ? privateModelCurrentSnapshot(forecast, scope) : null
  const model = useMemo(() => (
    forecast && predictive && draft && programmeDataAvailable
      ? buildPrivateModel(predictive, forecast, draft, scope) : []
  ), [forecast, predictive, draft, scope, programmeDataAvailable])
  const finalMonth = model.at(-1)
  const scenarioStarts = model.reduce((total, row) => total + row.scenarioStarts, 0)
  const staffedTutorMonths = model.reduce((total, row) => total + row.staffedTutors, 0)
  const understaffedMonths = model.filter((row) => row.additionalTutors > 0).length
  const scenarioCashIn = model.every((row) => row.scenarioCashIn !== null)
    ? model.reduce((total, row) => total + (row.scenarioCashIn ?? 0), 0) : null
  const scenarioPayroll = model.every((row) => row.scenarioPayroll !== null)
    ? model.reduce((total, row) => total + (row.scenarioPayroll ?? 0), 0) : null
  const marginChange = finalMonth?.cumulativeScenarioMargin === null || finalMonth?.cumulativeBaselineMargin === null || !finalMonth
    ? null : finalMonth.cumulativeScenarioMargin - finalMonth.cumulativeBaselineMargin
  const hasUnsavedChanges = Boolean(draft && savedAssumptions && (
    draft.effective_month !== savedAssumptions.effective_month
    || draft.cohort_size !== savedAssumptions.cohort_size
    || draft.staffed_tutors !== savedAssumptions.staffed_tutors
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
          staffed_tutors: draft.staffed_tutors,
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
      <div><p className="eyebrow">Restricted workspace</p><h1>Private Model</h1><p className="page-intro">Pharmacy L2 and L3 financial and staffing scenarios.</p></div>
      <div className="private-model-header-actions"><label className="private-model-scope"><span>Programme</span><select value={scope} onChange={(event) => setScope(event.target.value as PrivateModelScope)}><option value="both">Pharmacy L2 + L3</option><option value="pharmacy-l2">Pharmacy L2</option><option value="pharmacy-l3">Pharmacy L3</option></select></label><div className="admin-identity"><span>{access.is_owner ? 'Model owner' : 'Authorised access'}</span><strong>Entra protected</strong></div></div>
    </header>

    {loading && <section className="private-model-card"><p>Loading private model data…</p></section>}
    {error && <div className="tutor-message error" role="alert">{error}</div>}
    {predictive && !programmeDataAvailable && <div className="tutor-message error" role="alert">The selected Pharmacy programme forecast is incomplete. No scenario totals are shown until its monthly data is available.</div>}
    {message && <div className="tutor-message success" role="status">{message}</div>}

    {forecast && <>
      <section className="private-model-card">
        <p className="eyebrow">Shared data foundation</p>
        <h2>Current Pharmacy snapshot</h2>
        <p>Only the selected Pharmacy level{scope === 'both' ? 's' : ''} appear here. This tab reads the live Capacity forecast without changing its calculations.</p>
        <div className="private-model-metrics">
          <div><span>Current learners</span><strong>{currentSnapshot?.learners.toLocaleString('en-GB') ?? '—'}</strong><small className="private-model-formula">Capacity-consuming learners in the selected level{scope === 'both' ? 's' : ''} today</small></div>
          <div><span>Available tutor places</span><strong>{currentSnapshot?.remaining_places.toLocaleString('en-GB') ?? '—'}</strong><small className="private-model-formula">Selected programme capacity − current learners</small></div>
          <div><span>Programmes in model</span><strong>{selectedProgrammes.length}</strong><small className="private-model-formula">{scope === 'both' ? 'Pharmacy L2 and L3' : scope === 'pharmacy-l2' ? 'Pharmacy L2' : 'Pharmacy L3'}</small></div>
          <div><span>Data generated</span><strong>{formatDate(forecast.generated_at)}</strong><small className="private-model-formula">Date of the live Capacity snapshot</small></div>
        </div>
      </section>
    </>}

    {draft && predictive && programmeDataAvailable && <>
      <section className="private-model-card">
        <p className="eyebrow">Worst-case enrolment scenario</p>
        <h2>Model levers</h2>
        <p>From the selected month, reduce new starts in the selected Pharmacy level{scope === 'both' ? 's' : ''} by the chosen percentage. Existing learners remain until their forecast exit. Changes preview immediately; only the model owner can save the shared assumptions.</p>
        <div className="private-model-controls">
          <label><span>Scenario begins</span><select value={draft.effective_month} onChange={(event) => setDraft({ ...draft, effective_month: event.target.value })}>{!predictive.months.includes(draft.effective_month) && <option value={draft.effective_month}>{formatMonth(draft.effective_month)}</option>}{predictive.months.map((month) => <option key={month} value={month}>{formatMonth(month)}</option>)}</select></label>
          <label><span>New-start drop (%)</span><input type="number" min="0" max="100" step="1" value={draft.enrolment_drop_percent} onChange={(event) => setDraft({ ...draft, enrolment_drop_percent: Math.min(100, Math.max(0, Number(event.target.value))) })} /></label>
          <label><span>Target cohort size</span><input type="number" min="1" max="250" step="1" value={draft.cohort_size} onChange={(event) => setDraft({ ...draft, cohort_size: Math.min(250, Math.max(1, Math.round(Number(event.target.value) || 1))) })} /></label>
          <label><span>Tutors employed each month</span><input type="number" min="0" max="10000" step="1" value={draft.staffed_tutors ?? ''} placeholder="Auto: tutors required" onChange={(event) => setDraft({ ...draft, staffed_tutors: event.target.value === '' ? null : Math.min(10000, Math.max(0, Math.round(Number(event.target.value)))) })} /></label>
          <label><span>Contract value per starter (£)</span><input type="number" min="0" max="1000000" step="0.01" value={draft.average_contract_value ?? ''} placeholder="Enter amount" onChange={(event) => setDraft({ ...draft, average_contract_value: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} /></label>
          <label><span>Monthly tutor cost (£)</span><input type="number" min="0" max="1000000" step="0.01" value={draft.monthly_tutor_cost ?? ''} placeholder="Enter amount" onChange={(event) => setDraft({ ...draft, monthly_tutor_cost: event.target.value === '' ? null : Math.max(0, Number(event.target.value)) })} /></label>
        </div>
        <p className="private-model-note">Leave tutor count blank to staff each month at the calculated requirement. Enter a number to hold employed tutor headcount fixed across the selected Pharmacy level{scope === 'both' ? 's' : ''}; this changes payroll and coverage, not predicted enrolments. The saved tutor-count lever is shared across all three views.</p>
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
          <div><span>Scenario cash in</span><strong>{formatMoney(scenarioCashIn)}</strong><small className="private-model-formula">{scenarioStarts.toLocaleString('en-GB')} starts × {formatMoney(draft.average_contract_value)} per contract</small></div>
          <div><span>Scenario tutor payroll</span><strong>{formatMoney(scenarioPayroll)}</strong><small className="private-model-formula">{staffedTutorMonths.toLocaleString('en-GB')} staffed tutor-months × {formatMoney(draft.monthly_tutor_cost)}</small></div>
          <div><span>Cumulative cash margin</span><strong>{formatMoney(finalMonth?.cumulativeScenarioMargin)}</strong><small className="private-model-formula">{formatMoney(scenarioCashIn)} cash in − {formatMoney(scenarioPayroll)} payroll</small></div>
          <div><span>Last-month tutors required</span><strong>{finalMonth?.scenarioTutorsRequired.toLocaleString('en-GB') ?? '—'}</strong><small className="private-model-formula">Σ ceil(selected programme learners ÷ {draft.cohort_size} cohort size)</small></div>
          <div><span>Last-month tutors employed</span><strong>{finalMonth?.staffedTutors.toLocaleString('en-GB') ?? '—'}</strong><small className="private-model-formula">{draft.staffed_tutors === null ? 'Auto = tutors required' : `Fixed tutor lever = ${draft.staffed_tutors}`}</small></div>
          <div><span>Margin change vs baseline</span><strong className={marginChange !== null && marginChange < 0 ? 'private-model-negative' : ''}>{marginChange === null ? '—' : `${marginChange > 0 ? '+' : ''}${currencyFormatter.format(marginChange)}`}</strong><small className="private-model-formula">{formatMoney(finalMonth?.cumulativeScenarioMargin)} scenario − {formatMoney(finalMonth?.cumulativeBaselineMargin)} baseline</small></div>
        </div>
        {(draft.average_contract_value === null || draft.monthly_tutor_cost === null) && <p className="private-model-note">Enter contract value and monthly tutor cost to see the cash results.</p>}
        {understaffedMonths > 0 && <p className="private-model-coverage-warning" role="alert">Staffing is below calculated demand in {understaffedMonths} {understaffedMonths === 1 ? 'month' : 'months'}. Cash in still assumes all forecast starters enrol; this scenario needs more cover to be deliverable.</p>}
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
        <p>The baseline is the unshocked P80 forecast at a 50-learner target, not actual payroll. Required tutors are rounded separately for L2 and L3 when both are selected. Available tutors are distinct people with positive allocations to the selected programme(s); a tutor teaching both counts once. Shared tutors are not jointly optimised in this version.</p>
        <div className="private-model-table-wrap"><table className="private-model-table"><thead><tr><th>Month</th><th>Starts<br />base → scenario</th><th>Active learners<br />base → scenario</th><th>Tutors required<br />base → scenario</th><th>Available<br />tutors</th><th>Staffed<br />tutors</th><th>Coverage</th><th>Change vs<br />available</th><th>Cash in<br />base → scenario</th><th>Tutor payroll<br />base → scenario</th><th>Cash margin<br />base → scenario</th><th>Cumulative margin<br />base → scenario</th></tr></thead><tbody>
          {model.map((row) => <tr key={row.month}><th scope="row">{formatMonth(row.month)}</th><td>{row.baselineStarts} → <strong>{row.scenarioStarts}</strong></td><td>{row.baselineActive} → <strong>{row.scenarioActive}</strong></td><td>{row.baselineTutorsRequired} → <strong>{row.scenarioTutorsRequired}</strong></td><td>{row.availableTutors}</td><td><strong>{row.staffedTutors}</strong></td><td className={row.additionalTutors ? 'private-model-negative' : ''}>{row.additionalTutors ? `${row.additionalTutors} short` : row.potentialSurplus ? `${row.potentialSurplus} spare` : 'Covered'}</td><td>{row.headcountChange > 0 ? '+' : ''}{row.headcountChange}</td><td>{formatMoney(row.baselineCashIn)} → <strong>{formatMoney(row.scenarioCashIn)}</strong></td><td>{formatMoney(row.baselinePayroll)} → <strong>{formatMoney(row.scenarioPayroll)}</strong></td><td className={row.scenarioMargin !== null && row.scenarioMargin < 0 ? 'private-model-negative' : ''}>{formatMoney(row.baselineMargin)} → <strong>{formatMoney(row.scenarioMargin)}</strong></td><td className={row.cumulativeScenarioMargin !== null && row.cumulativeScenarioMargin < 0 ? 'private-model-negative' : ''}>{formatMoney(row.cumulativeBaselineMargin)} → <strong>{formatMoney(row.cumulativeScenarioMargin)}</strong></td></tr>)}
        </tbody></table></div>
        <p className="private-model-note">Cash in assumes the full contract value is collected in the start month. Cash already collected for existing learners before this forecast is not included, although their tutor cost is; absolute margin is therefore not accounting profit. Payroll follows the entered fixed tutor count or, if blank, the calculated monthly requirement. The scenario uses programme-specific typical durations, so individual future starters may finish at different dates. Other Pharmacy programmes, unclassified Pharmacy demand, other workstreams, technology, overhead, collection risk and other costs are not included.</p>
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

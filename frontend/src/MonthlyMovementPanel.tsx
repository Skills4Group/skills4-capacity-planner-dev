import { useEffect, useState } from 'react'
import type { MonthlyMovementRate, SessionResponse } from './types'

const monthFormatter = new Intl.DateTimeFormat('en-GB', {
  month: 'short', year: 'numeric', timeZone: 'UTC',
})

interface Props {
  rates: MonthlyMovementRate[]
  onSaved: () => void | Promise<void>
}

export function MonthlyMovementPanel({ rates, onSaved }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, { bil: string; oof: string }>>({})
  const [savingMonth, setSavingMonth] = useState<string | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    setDrafts(Object.fromEntries(rates.map((rate) => [
      rate.month, { bil: String(rate.bil_percent), oof: String(rate.oof_percent) },
    ])))
  }, [rates])

  useEffect(() => {
    let active = true
    void fetch('/api/v1/session').then((response) => response.json() as Promise<SessionResponse>)
      .then((session) => { if (active) setIsAdmin(session.is_admin) })
      .catch(() => { if (active) setIsAdmin(false) })
    return () => { active = false }
  }, [])

  function update(month: string, field: 'bil' | 'oof', value: string) {
    if (!/^\d*(\.\d{0,2})?$/.test(value)) return
    setDrafts((current) => ({
      ...current, [month]: { ...current[month], [field]: value },
    }))
  }

  async function save(month: string) {
    const draft = drafts[month]
    const bil = Number(draft.bil)
    const oof = Number(draft.oof)
    if (!draft.bil || !draft.oof || !Number.isFinite(bil) || !Number.isFinite(oof)
      || bil < 0 || oof < 0 || bil + oof > 100) {
      setError('Enter valid BIL and OOF percentages with a combined maximum of 100%.')
      return
    }
    setSavingMonth(month)
    setError('')
    try {
      const response = await fetch(`/api/v1/predictive-movement-rates/${month}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bil_percent: bil, oof_percent: oof }),
      })
      if (!response.ok) throw new Error('Save failed')
      await onSaved()
    } catch {
      setError('Monthly BIL/OOF rates could not be saved. Please try again.')
    } finally {
      setSavingMonth(null)
    }
  }

  return (
    <section className="programme-planning-card movement-rate-card" aria-labelledby="movement-rate-title">
      <div className="programme-planning-heading">
        <div>
          <p className="eyebrow">Shared planning assumptions</p>
          <h2 id="movement-rate-title">Monthly BIL and OOF rates</h2>
          <p>Each defaults to 4% of that month's projected starts. The deduction is applied once when a future cohort starts, then that smaller cohort carries forward. Today's existing learners are unchanged.</p>
        </div>
        <button className="programme-planning-toggle" type="button" aria-expanded={expanded} aria-controls="movement-rate-content" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Collapse rates' : 'Edit monthly rates'}<span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
      </div>
      <div id="movement-rate-content" hidden={!expanded}>
        {error && <p className="movement-rate-error" role="alert">{error}</p>}
        <div className="programme-planning-table-wrap">
          <table className="programme-planning-table movement-rate-table">
            <thead><tr><th>Month</th><th>BIL %</th><th>OOF %</th><th>Total projected reduction</th><th>Action</th></tr></thead>
            <tbody>{rates.map((rate) => {
              const draft = drafts[rate.month]
              const bil = Number(draft?.bil)
              const oof = Number(draft?.oof)
              const valid = draft?.bil !== '' && draft?.oof !== '' && Number.isFinite(bil) && Number.isFinite(oof) && bil + oof <= 100
              const changed = bil !== rate.bil_percent || oof !== rate.oof_percent
              return <tr key={rate.month}>
                <td><strong>{monthFormatter.format(new Date(`${rate.month}T00:00:00Z`))}</strong></td>
                <td><input aria-label={`BIL percentage for ${rate.month}`} type="number" min="0" max="100" step="0.01" value={draft?.bil ?? ''} disabled={!isAdmin} onChange={(event) => update(rate.month, 'bil', event.target.value)} /></td>
                <td><input aria-label={`OOF percentage for ${rate.month}`} type="number" min="0" max="100" step="0.01" value={draft?.oof ?? ''} disabled={!isAdmin} onChange={(event) => update(rate.month, 'oof', event.target.value)} /></td>
                <td>{valid ? `${(bil + oof).toFixed(2).replace(/\.00$/, '')}%` : '—'}</td>
                <td><button className="save-tutor-button" type="button" disabled={!isAdmin || !changed || !valid || savingMonth !== null} onClick={() => void save(rate.month)}>{savingMonth === rate.month ? 'Saving…' : 'Save month'}</button></td>
              </tr>
            })}</tbody>
          </table>
        </div>
        <p className="predictive-scenario-footnote">Only admins can change these shared Capacity Tracker assumptions. Attendance is never updated.</p>
      </div>
    </section>
  )
}

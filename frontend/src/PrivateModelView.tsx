import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ForecastResponse,
  PrivateModelAccessResponse,
  PrivateModelDirectoryResponse,
} from './types'

const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
})

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
        const response = await fetch('/api/v1/private-model/forecast', { cache: 'no-store' })
        if (!response.ok) throw new Error(await responseError(response, 'Private model data could not be loaded'))
        const payload = await response.json() as ForecastResponse
        if (!active) return
        setForecast(payload)
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
      <section className="private-model-card">
        <p className="eyebrow">Model design</p>
        <h2>Ready to define</h2>
        <p>No new formula is applied yet. The model will be developed independently while drawing on the current Capacity forecast data.</p>
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

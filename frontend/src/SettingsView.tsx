import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type {
  AdminUserListResponse,
  SessionResponse,
} from './types'

const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { detail?: string | Array<{ msg?: string }> }
    if (typeof payload.detail === 'string') return payload.detail
    if (Array.isArray(payload.detail)) {
      return payload.detail.map((item) => item.msg).filter(Boolean).join('. ') || fallback
    }
  } catch {
    // Use the user-facing fallback when the API did not return JSON.
  }
  return fallback
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(value))
}

export function SettingsView() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [directory, setDirectory] = useState<AdminUserListResponse | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [email, setEmail] = useState('')
  const [objectId, setObjectId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const loadAdmins = useCallback(async () => {
    const response = await fetch('/api/v1/admin-users', { cache: 'no-store' })
    if (!response.ok) throw new Error(await responseError(response, 'Administrator list could not be loaded'))
    setDirectory(await response.json() as AdminUserListResponse)
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const response = await fetch('/api/v1/session', { cache: 'no-store' })
        if (!response.ok) throw new Error('Your sign-in status could not be checked')
        const currentSession = await response.json() as SessionResponse
        if (!active) return
        setSession(currentSession)
        if (currentSession.is_admin) await loadAdmins()
        if (active) setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Settings are temporarily unavailable')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [loadAdmins])

  async function addAdministrator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!guidPattern.test(objectId.trim()) || !displayName.trim()) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const response = await fetch('/api/v1/admin-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object_id: objectId.trim(),
          display_name: displayName.trim(),
          email: email.trim() || null,
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Administrator could not be added'))
      await loadAdmins()
      setDisplayName('')
      setEmail('')
      setObjectId('')
      setMessage('Administrator added. Their existing Entra sign-in will now receive admin access.')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Administrator could not be added')
    } finally {
      setSaving(false)
    }
  }

  async function removeAdministrator(targetObjectId: string, targetName: string) {
    if (!window.confirm(`Remove Capacity Tracker administrator access for ${targetName}?`)) return
    setRemovingId(targetObjectId)
    setError('')
    setMessage('')
    try {
      const response = await fetch(`/api/v1/admin-users/${encodeURIComponent(targetObjectId)}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Administrator could not be removed'))
      await loadAdmins()
      setMessage(`${targetName} no longer has Capacity Tracker administrator access.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Administrator could not be removed')
    } finally {
      setRemovingId(null)
    }
  }

  if (loading) return <section className="settings-state"><span className="predictive-loader" /><p>Checking administrator access…</p></section>

  if (!session?.is_admin) {
    return (
      <>
        <header className="topbar"><div><p className="eyebrow">Application administration</p><h1>Settings</h1><p className="page-intro">Manage Capacity Tracker access and configuration.</p></div></header>
        <section className="settings-access-card">
          <p className="eyebrow">Read-only access</p>
          <h2>Administrator permission required</h2>
          <p>You are signed in through Microsoft Entra ID, but your account is not authorised to manage Capacity Tracker administrators.</p>
          {session?.object_id && <dl><dt>Your Entra Object ID</dt><dd>{session.object_id}</dd></dl>}
          {error && <div className="tutor-message error" role="alert">{error}</div>}
        </section>
      </>
    )
  }

  const validObjectId = guidPattern.test(objectId.trim())

  return (
    <>
      <header className="topbar">
        <div><p className="eyebrow">Application administration</p><h1>Settings</h1><p className="page-intro">Manage administrative access through Microsoft Entra ID.</p></div>
        <div className="admin-identity"><span>Admin access</span><strong>{session.display_name ?? 'Capacity administrator'}</strong></div>
      </header>

      <section className="settings-admin-grid">
        <article className="settings-form-card">
          <div><p className="eyebrow">Add administrator</p><h2>Authorise an Entra user</h2><p>Add the user’s Entra Object ID. No password or separate Capacity Tracker account is created.</p></div>
          <form onSubmit={addAdministrator}>
            <label><span>Name</span><input value={displayName} maxLength={200} onChange={(event) => setDisplayName(event.target.value)} placeholder="e.g. Alex Taylor" required /></label>
            <label><span>Email address</span><input value={email} maxLength={320} onChange={(event) => setEmail(event.target.value)} placeholder="alex.taylor@skills4group.co.uk" type="email" /></label>
            <label><span>Microsoft Entra Object ID</span><input className={objectId && !validObjectId ? 'invalid' : ''} value={objectId} onChange={(event) => setObjectId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" required /><small>Azure portal → Microsoft Entra ID → Users → select the user → Object ID</small></label>
            <button className="settings-primary-button" disabled={saving || !displayName.trim() || !validObjectId}>{saving ? 'Adding…' : 'Add administrator'}</button>
          </form>
        </article>

        <article className="settings-security-card">
          <p className="eyebrow">Security model</p>
          <h2>Existing Entra sign-in</h2>
          <ul><li>Access is matched using the immutable Entra Object ID.</li><li>Only an existing administrator can add or remove administrators.</li><li>Bootstrap administrators configured in Azure cannot be removed here.</li><li>All entries are stored in the Capacity database; Attendance remains read only.</li></ul>
        </article>
      </section>

      {message && <div className="tutor-message success" role="status">{message}</div>}
      {error && <div className="tutor-message error" role="alert">{error}</div>}

      <section className="settings-directory-card">
        <div className="section-heading"><div><p className="eyebrow">Access directory</p><h2>Capacity administrators</h2><p>{directory?.admins.length ?? 0} authorised account{directory?.admins.length === 1 ? '' : 's'}</p></div></div>
        <div className="table-wrap">
          <table className="settings-admin-table">
            <thead><tr><th>User</th><th>Entra Object ID</th><th>Access source</th><th>Added</th><th>Audit</th><th></th></tr></thead>
            <tbody>{directory?.admins.map((admin) => { const isCurrent = admin.object_id.toLowerCase() === directory.current_object_id.toLowerCase(); return <tr key={admin.object_id}><td><strong>{admin.display_name}</strong><small>{admin.email ?? (isCurrent ? session.display_name : 'No email recorded')}</small>{isCurrent && <span className="current-admin-pill">Current user</span>}</td><td><code>{admin.object_id}</code></td><td><span className={`configuration-pill ${admin.source === 'configuration' ? 'saved' : 'inferred'}`}>{admin.source === 'configuration' ? 'Azure configuration' : 'Capacity database'}</span></td><td>{formatDate(admin.created_at)}</td><td><small>{admin.updated_by ? `Updated by ${admin.updated_by}` : 'Managed in Azure'}</small></td><td><button className="settings-remove-button" disabled={!admin.removable || isCurrent || removingId !== null} title={!admin.removable ? 'Remove this bootstrap administrator from the Azure app configuration' : isCurrent ? 'You cannot remove your own access' : undefined} onClick={() => removeAdministrator(admin.object_id, admin.display_name)}>{removingId === admin.object_id ? 'Removing…' : 'Remove'}</button></td></tr> })}</tbody>
          </table>
        </div>
      </section>
    </>
  )
}

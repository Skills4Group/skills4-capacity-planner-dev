import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SessionResponse, TutorAdminRecord, TutorListResponse, Workstream } from './types'

const workstreams: Workstream[] = ['Dental', 'Pharmacy', 'Housing', 'Science']

interface TutorDraft {
  capacity: string
  workstream: Workstream | ''
}

interface TutorsViewProps {
  onForecastRefresh: () => Promise<void>
}

function sourceLabel(source: TutorAdminRecord['workstream_source']) {
  if (source === 'saved') return 'Configured'
  if (source === 'inferred') return 'Inferred'
  return 'Needs workstream'
}

export function TutorsView({ onForecastRefresh }: TutorsViewProps) {
  const [tutors, setTutors] = useState<TutorAdminRecord[]>([])
  const [session, setSession] = useState<SessionResponse>({ authenticated: false, is_admin: false, display_name: null })
  const [drafts, setDrafts] = useState<Record<string, TutorDraft>>({})
  const [search, setSearch] = useState('')
  const [workstreamFilter, setWorkstreamFilter] = useState<Workstream | 'All' | 'Unassigned'>('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const loadTutors = useCallback(async () => {
    const response = await fetch('/api/v1/tutors')
    if (!response.ok) throw new Error('Tutor data is unavailable')
    const payload = await response.json() as TutorListResponse
    setTutors(payload.tutors)
    setDrafts(Object.fromEntries(payload.tutors.map((tutor) => [
      tutor.tutor_id,
      { capacity: String(tutor.capacity), workstream: tutor.workstream ?? '' },
    ])))
  }, [])

  useEffect(() => {
    let active = true
    Promise.all([
      loadTutors(),
      fetch('/api/v1/session')
        .then((response) => response.ok ? response.json() as Promise<SessionResponse> : Promise.reject())
        .then((payload) => { if (active) setSession(payload) })
        .catch(() => undefined),
    ])
      .catch(() => { if (active) setError('Tutor data could not be loaded. Please try again.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [loadTutors])

  const visibleTutors = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tutors.filter((tutor) => {
      const matchesSearch = !query || tutor.tutor_name.toLowerCase().includes(query) || tutor.tutor_id.toLowerCase().includes(query)
      const matchesWorkstream = workstreamFilter === 'All'
        || (workstreamFilter === 'Unassigned' ? tutor.workstream === null : tutor.workstream === workstreamFilter)
      return matchesSearch && matchesWorkstream
    })
  }, [search, tutors, workstreamFilter])

  const summary = useMemo(() => ({
    active: tutors.length,
    configured: tutors.filter((tutor) => tutor.has_saved_setting).length,
    custom: tutors.filter((tutor) => tutor.capacity !== 50).length,
    unassigned: tutors.filter((tutor) => tutor.workstream === null).length,
    places: tutors.reduce((sum, tutor) => sum + tutor.capacity, 0),
  }), [tutors])

  function changeDraft(tutorId: string, change: Partial<TutorDraft>) {
    setSavedId(null)
    setDrafts((current) => ({
      ...current,
      [tutorId]: { ...current[tutorId], ...change },
    }))
  }

  async function saveTutor(tutor: TutorAdminRecord) {
    const draft = drafts[tutor.tutor_id]
    const capacity = Number(draft.capacity)
    if (!session.is_admin || !draft.workstream || !Number.isInteger(capacity) || capacity < 1 || capacity > 250) return
    setSavingId(tutor.tutor_id)
    setError('')
    try {
      const response = await fetch(`/api/v1/tutors/${encodeURIComponent(tutor.tutor_id)}/capacity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capacity, workstream: draft.workstream }),
      })
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null
        throw new Error(detail?.detail ?? 'The tutor setting could not be saved')
      }
      await Promise.all([loadTutors(), onForecastRefresh()])
      setSavedId(tutor.tutor_id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The tutor setting could not be saved')
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="tutors-view">
      <header className="topbar tutors-topbar">
        <div>
          <p className="eyebrow">Tutor administration</p>
          <h1>Tutors</h1>
          <p className="page-intro">Set each tutor's maximum learner caseload and workstream.</p>
        </div>
        {session.is_admin ? (
          <div className="admin-identity"><span>Admin access</span><strong>{session.display_name ?? 'Capacity administrator'}</strong></div>
        ) : session.authenticated ? (
          <div className="admin-identity read-only"><span>Read only</span><strong>{session.display_name ?? 'Signed-in user'}</strong></div>
        ) : (
          <a className="admin-signin" href="/.auth/login/aad?post_login_redirect_uri=/">Sign in as admin</a>
        )}
      </header>

      <section className="tutor-summary-grid" aria-label="Tutor configuration summary">
        <article><span>Active tutors</span><strong>{summary.active}</strong><small>from Attendance</small></article>
        <article><span>Configured</span><strong>{summary.configured}</strong><small>saved settings</small></article>
        <article><span>Custom capacity</span><strong>{summary.custom}</strong><small>not using 50</small></article>
        <article className={summary.unassigned ? 'attention' : ''}><span>Needs workstream</span><strong>{summary.unassigned}</strong><small>must be assigned</small></article>
        <article><span>Total capacity</span><strong>{summary.places}</strong><small>learner places</small></article>
      </section>

      <section className="tutor-management-card">
        <div className="tutor-management-heading">
          <div>
            <p className="eyebrow">Capacity settings</p>
            <h2>Active tutor directory</h2>
            <p>Changes take effect today, remain in the Capacity audit history, and refresh every forecast. Attendance is never updated.</p>
          </div>
          <div className="tutor-tools">
            <label><span>Workstream</span><select value={workstreamFilter} onChange={(event) => setWorkstreamFilter(event.target.value as typeof workstreamFilter)}><option>All</option>{workstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}<option>Unassigned</option></select></label>
            <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tutor name or ID" /></label>
          </div>
        </div>

        {error && <div className="tutor-message error" role="alert">{error}</div>}
        {!session.is_admin && !loading && <div className="tutor-message">Capacity settings are read only until an authorised administrator signs in.</div>}

        <div className="tutor-admin-table-wrap">
          <table className="tutor-admin-table">
            <thead><tr><th>Tutor</th><th>Workstream</th><th>Current learners</th><th>Maximum capacity</th><th>Remaining</th><th>Configuration</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="empty-row">Loading active tutors…</td></tr>
              ) : visibleTutors.length === 0 ? (
                <tr><td colSpan={7} className="empty-row">No tutors match these filters.</td></tr>
              ) : visibleTutors.map((tutor) => {
                const draft = drafts[tutor.tutor_id] ?? { capacity: String(tutor.capacity), workstream: tutor.workstream ?? '' }
                const draftCapacity = Number(draft.capacity)
                const validCapacity = Number.isInteger(draftCapacity) && draftCapacity >= 1 && draftCapacity <= 250
                const dirty = draftCapacity !== tutor.capacity || draft.workstream !== (tutor.workstream ?? '')
                const remaining = validCapacity ? draftCapacity - tutor.current_caseload : tutor.remaining_capacity
                return (
                  <tr key={tutor.tutor_id} className={tutor.workstream === null ? 'unassigned-row' : ''}>
                    <td><strong>{tutor.tutor_name}</strong><small>{tutor.tutor_id}</small></td>
                    <td><select aria-label={`${tutor.tutor_name} workstream`} value={draft.workstream} disabled={!session.is_admin} onChange={(event) => changeDraft(tutor.tutor_id, { workstream: event.target.value as Workstream | '' })}><option value="">Select workstream</option>{workstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}</select></td>
                    <td><strong>{tutor.current_caseload}</strong></td>
                    <td><div className={`capacity-input ${!validCapacity ? 'invalid' : ''}`}><input aria-label={`${tutor.tutor_name} maximum capacity`} type="number" min="1" max="250" step="1" value={draft.capacity} disabled={!session.is_admin} onChange={(event) => changeDraft(tutor.tutor_id, { capacity: event.target.value })} /><span>learners</span></div></td>
                    <td><strong className={remaining < 0 ? 'negative' : ''}>{remaining}</strong></td>
                    <td><span className={`configuration-pill ${tutor.workstream_source}`}>{sourceLabel(tutor.workstream_source)}</span>{tutor.updated_by && <small>by {tutor.updated_by}</small>}</td>
                    <td><button className="save-tutor-button" disabled={!session.is_admin || !dirty || !draft.workstream || !validCapacity || savingId !== null} onClick={() => saveTutor(tutor)}>{savingId === tutor.tutor_id ? 'Saving…' : savedId === tutor.tutor_id ? 'Saved' : 'Save'}</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

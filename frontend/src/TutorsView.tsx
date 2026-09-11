import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  reportingWorkstreams,
  workstreams,
  type SessionResponse,
  type ProgrammePlanningRecord,
  type TutorAdminRecord,
  type TutorListResponse,
  type Workstream,
} from './types'
import { calculateTutorUtilisation } from './tutorUtilisation'

interface TutorDraft {
  capacity: string
  allocations: Array<{ programmeCode: string; capacity: string }>
  onMaternityLeave: boolean
  maternityReturnDate: string
  deliveryEligible: boolean
}

function initialAllocations(
  tutor: TutorAdminRecord,
  programmes: ProgrammePlanningRecord[],
) {
  if (tutor.programme_allocations.length) {
    return tutor.programme_allocations.map((allocation) => ({
      programmeCode: allocation.programme_code,
      capacity: String(allocation.capacity),
    }))
  }
  const generic = programmes.find((programme) => (
    programme.active
    && programme.workstream === tutor.workstream
    && programme.programme_code.endsWith('-general')
  )) ?? programmes.find((programme) => programme.active && programme.workstream === tutor.workstream)
  return generic ? [{ programmeCode: generic.programme_code, capacity: String(tutor.capacity) }] : []
}

interface TutorsViewProps {
  onForecastRefresh: () => Promise<void>
  onDiscoveryCountChange: (count: number) => void
}

const discoveredFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

function sourceLabel(source: TutorAdminRecord['workstream_source']) {
  if (source === 'saved') return 'Configured'
  if (source === 'inferred') return 'Inferred'
  return 'Needs workstream'
}

export function TutorsView({
  onForecastRefresh,
  onDiscoveryCountChange,
}: TutorsViewProps) {
  const [tutors, setTutors] = useState<TutorAdminRecord[]>([])
  const [programmes, setProgrammes] = useState<ProgrammePlanningRecord[]>([])
  const [session, setSession] = useState<SessionResponse>({ authenticated: false, is_admin: false, object_id: null, display_name: null, email: null })
  const [drafts, setDrafts] = useState<Record<string, TutorDraft>>({})
  const [search, setSearch] = useState('')
  const [workstreamFilter, setWorkstreamFilter] = useState<Workstream | 'All' | 'Unassigned' | 'New' | 'Inactive' | 'Non-delivery'>('All')
  const [programmeFilter, setProgrammeFilter] = useState('All')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null)
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null)

  const loadTutors = useCallback(async () => {
    const response = await fetch('/api/v1/tutors')
    if (!response.ok) throw new Error('Tutor data is unavailable')
    const payload = await response.json() as TutorListResponse
    const tutorIds = payload.tutors.map((tutor) => tutor.tutor_id.trim())
    if (tutorIds.some((tutorId) => !tutorId) || new Set(tutorIds).size !== tutorIds.length) {
      throw new Error('Tutor data contains an invalid or duplicate identifier')
    }
    setTutors(payload.tutors)
    setProgrammes(payload.programmes)
    onDiscoveryCountChange(payload.new_tutor_count)
    setDrafts(Object.fromEntries(payload.tutors.map((tutor) => [
      tutor.tutor_id,
      {
        capacity: String(tutor.capacity),
        allocations: initialAllocations(tutor, payload.programmes),
        onMaternityLeave: tutor.on_maternity_leave,
        maternityReturnDate: tutor.maternity_return_date ?? '',
        deliveryEligible: tutor.delivery_eligible,
      },
    ])))
  }, [onDiscoveryCountChange])

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
        || (workstreamFilter === 'Unassigned'
          ? tutor.programme_allocations.length === 0 && tutor.workstream === null && tutor.is_active
          : workstreamFilter === 'New'
            ? tutor.is_new
            : workstreamFilter === 'Inactive'
              ? !tutor.is_active
              : workstreamFilter === 'Non-delivery'
                ? tutor.is_active && !tutor.delivery_eligible
              : tutor.programme_allocations.some((allocation) => allocation.workstream === workstreamFilter)
                || (tutor.programme_allocations.length === 0 && tutor.workstream === workstreamFilter))
      const matchesProgramme = programmeFilter === 'All'
        || tutor.programme_allocations.some((allocation) => allocation.programme_code === programmeFilter)
      return matchesSearch && matchesWorkstream && matchesProgramme
    })
  }, [programmeFilter, search, tutors, workstreamFilter])

  const summary = useMemo(() => ({
    active: tutors.filter((tutor) => tutor.is_active && tutor.delivery_eligible && (
      tutor.programme_allocations.some((allocation) => reportingWorkstreams.includes(allocation.workstream))
      || (tutor.programme_allocations.length === 0 && tutor.workstream !== null && reportingWorkstreams.includes(tutor.workstream))
    )).length,
    inactive: tutors.filter((tutor) => !tutor.is_active).length,
    nonDelivery: tutors.filter((tutor) => tutor.is_active && !tutor.delivery_eligible).length,
    configured: tutors.filter((tutor) => tutor.has_saved_setting).length,
    custom: tutors.filter((tutor) => tutor.is_active && tutor.capacity !== 50).length,
    maternity: tutors.filter((tutor) => tutor.is_active && tutor.delivery_eligible && tutor.on_maternity_leave && tutor.workstream !== null && reportingWorkstreams.includes(tutor.workstream)).length,
    unassigned: tutors.filter((tutor) => tutor.is_active && tutor.programme_allocations.length === 0 && tutor.workstream === null).length,
    newTutors: tutors.filter((tutor) => tutor.is_new).length,
    places: tutors.reduce((sum, tutor) => (
      tutor.is_active && tutor.delivery_eligible && tutor.workstream !== null && reportingWorkstreams.includes(tutor.workstream)
        ? sum + tutor.effective_capacity
        : sum
    ), 0),
  }), [tutors])

  function changeDraft(tutorId: string, change: Partial<TutorDraft>) {
    setSavedId(null)
    setDrafts((current) => ({
      ...current,
      [tutorId]: { ...current[tutorId], ...change },
    }))
  }

  function changeAllocation(tutorId: string, index: number, change: Partial<{ programmeCode: string; capacity: string }>) {
    const allocations = [...(drafts[tutorId]?.allocations ?? [])]
    allocations[index] = { ...allocations[index], ...change }
    changeDraft(tutorId, { allocations })
  }

  function addAllocation(tutorId: string) {
    const used = new Set(drafts[tutorId]?.allocations.map((row) => row.programmeCode) ?? [])
    const programme = programmes.find((row) => row.active && !used.has(row.programme_code))
    if (!programme) return
    changeDraft(tutorId, {
      allocations: [...(drafts[tutorId]?.allocations ?? []), { programmeCode: programme.programme_code, capacity: '0' }],
    })
  }

  function removeAllocation(tutorId: string, index: number) {
    changeDraft(tutorId, {
      allocations: (drafts[tutorId]?.allocations ?? []).filter((_, rowIndex) => rowIndex !== index),
    })
  }

  async function saveTutor(tutor: TutorAdminRecord) {
    const draft = drafts[tutor.tutor_id]
    const capacity = Number(draft.capacity)
    const allocations = draft.allocations.map((row) => ({
      programme: programmes.find((programme) => programme.programme_code === row.programmeCode),
      capacity: Number(row.capacity),
    }))
    const allocationTotal = allocations.reduce((sum, row) => sum + row.capacity, 0)
    const uniqueCodes = new Set(draft.allocations.map((row) => row.programmeCode))
    if (!session.is_admin || !allocations.length || allocations.some((row) => !row.programme || !Number.isInteger(row.capacity) || row.capacity < 0) || uniqueCodes.size !== allocations.length || allocationTotal !== capacity || !Number.isInteger(capacity) || capacity < 0 || capacity > 250) return
    const primaryWorkstream = allocations[0].programme!.workstream
    setSavingId(tutor.tutor_id)
    setError('')
    try {
      const response = await fetch(`/api/v1/tutors/${encodeURIComponent(tutor.tutor_id)}/capacity`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capacity,
          workstream: primaryWorkstream,
          on_maternity_leave: draft.onMaternityLeave,
          maternity_return_date: draft.onMaternityLeave && draft.maternityReturnDate
            ? draft.maternityReturnDate
            : null,
          delivery_eligible: draft.deliveryEligible,
          programme_allocations: allocations.map((row) => ({
            programme_code: row.programme!.programme_code,
            programme_name: row.programme!.display_name,
            workstream: row.programme!.workstream,
            capacity: row.capacity,
          })),
        }),
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

  async function acknowledgeTutor(tutor: TutorAdminRecord) {
    if (!session.is_admin || !tutor.is_new) return
    setAcknowledgingId(tutor.tutor_id)
    setError('')
    try {
      const response = await fetch(
        `/api/v1/tutors/${encodeURIComponent(tutor.tutor_id)}/acknowledge`,
        { method: 'PUT' },
      )
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null
        throw new Error(detail?.detail ?? 'The tutor could not be acknowledged')
      }
      await loadTutors()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The tutor could not be acknowledged')
    } finally {
      setAcknowledgingId(null)
    }
  }

  async function updateTutorStatus(tutor: TutorAdminRecord) {
    if (!session.is_admin) return
    const nextActive = !tutor.is_active
    if (!nextActive && !window.confirm(`Deactivate ${tutor.tutor_name}? Their capacity will be removed from every forecast, while their learners remain as demand requiring reassignment.`)) return
    setStatusUpdatingId(tutor.tutor_id)
    setError('')
    try {
      const response = await fetch(
        `/api/v1/tutors/${encodeURIComponent(tutor.tutor_id)}/status`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: nextActive }),
        },
      )
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { detail?: string } | null
        throw new Error(detail?.detail ?? 'The tutor status could not be saved')
      }
      await Promise.all([loadTutors(), onForecastRefresh()])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The tutor status could not be saved')
    } finally {
      setStatusUpdatingId(null)
    }
  }

  return (
    <div className="tutors-view">
      <header className="topbar tutors-topbar">
        <div>
          <p className="eyebrow">Tutor administration</p>
          <h1>Tutors</h1>
          <p className="page-intro">Manage tutor status, maximum learner caseload and workstream.</p>
        </div>
        {session.is_admin ? (
          <div className="admin-identity"><span>Admin access</span><strong>{session.display_name ?? 'Capacity administrator'}</strong></div>
        ) : session.authenticated ? (
          <div className="admin-identity read-only"><span>Read only</span><strong>{session.display_name ?? 'Signed-in user'}</strong></div>
        ) : (
          <a className="admin-signin" href="/.auth/login/aad?post_login_redirect_uri=/">Sign in as admin</a>
        )}
      </header>

      {summary.newTutors > 0 && (
        <section className="new-tutor-review-banner" role="status">
          <div className="new-tutor-review-count">{summary.newTutors}</div>
          <div><h2>New tutor{summary.newTutors === 1 ? '' : 's'} awaiting review</h2><p>Review workstream and capacity. Saving their settings acknowledges them automatically.</p></div>
          <button onClick={() => setWorkstreamFilter('New')}>Show new tutors</button>
        </section>
      )}

      <section className="tutor-summary-grid" aria-label="Tutor configuration summary">
        <article><span>Active tutors</span><strong>{summary.active}</strong><small>included in forecasts</small></article>
        <article className={summary.inactive ? 'attention' : ''}><span>Inactive tutors</span><strong>{summary.inactive}</strong><small>excluded from calculations</small></article>
        <article className={summary.nonDelivery ? 'attention' : ''}><span>Non-delivery</span><strong>{summary.nonDelivery}</strong><small>excluded from calculations</small></article>
        <article><span>Configured</span><strong>{summary.configured}</strong><small>saved settings</small></article>
        <article><span>Custom capacity</span><strong>{summary.custom}</strong><small>not using 50</small></article>
        <article className={summary.maternity ? 'attention' : ''}><span>Maternity leave</span><strong>{summary.maternity}</strong><small>currently unavailable</small></article>
        <article className={summary.unassigned ? 'attention' : ''}><span>Needs allocation</span><strong>{summary.unassigned}</strong><small>must be assigned</small></article>
        <article><span>Total capacity</span><strong>{summary.places}</strong><small>learner places</small></article>
      </section>

      <section className="tutor-management-card">
        <div className="tutor-management-heading">
          <div>
            <p className="eyebrow">Capacity settings</p>
            <h2>Tutor directory</h2>
            <p>Only active delivery tutors contribute capacity. Maternity return dates restore capacity from the first day of that month. Attendance is never updated.</p>
          </div>
          <div className="tutor-tools">
            <label><span>View</span><select value={workstreamFilter} onChange={(event) => setWorkstreamFilter(event.target.value as typeof workstreamFilter)}><option>All</option><option>New</option><option>Inactive</option><option>Non-delivery</option>{workstreams.map((workstream) => <option key={workstream}>{workstream}</option>)}<option>Unassigned</option></select></label>
            <label><span>Programme</span><select value={programmeFilter} onChange={(event) => setProgrammeFilter(event.target.value)}><option value="All">All programmes</option>{programmes.filter((programme) => programme.active && programme.workstream !== 'Operations').map((programme) => <option key={programme.programme_code} value={programme.programme_code}>{programme.display_name}</option>)}</select></label>
            <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Tutor name or ID" /></label>
          </div>
        </div>

        {error && <div className="tutor-message error" role="alert">{error}</div>}
        {!session.is_admin && !loading && <div className="tutor-message">Capacity settings are read only until an authorised administrator signs in.</div>}

        <div className="tutor-admin-table-wrap">
          <table className="tutor-admin-table">
            <thead><tr><th>Tutor</th><th>Teaching allocations</th><th>Current learners</th><th>Maximum capacity</th><th>Delivery role</th><th>Maternity leave</th><th>Return month</th><th>Tutor status</th><th>Remaining</th><th>Utilisation</th><th>Configuration</th><th></th></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={12} className="empty-row">Loading tutors…</td></tr>
              ) : visibleTutors.length === 0 ? (
                <tr><td colSpan={12} className="empty-row">No tutors match these filters.</td></tr>
              ) : visibleTutors.map((tutor) => {
                const draft = drafts[tutor.tutor_id] ?? {
                  capacity: String(tutor.capacity),
                  allocations: initialAllocations(tutor, programmes),
                  onMaternityLeave: tutor.on_maternity_leave,
                  maternityReturnDate: tutor.maternity_return_date ?? '',
                  deliveryEligible: tutor.delivery_eligible,
                }
                const draftCapacity = Number(draft.capacity)
                const validCapacity = Number.isInteger(draftCapacity) && draftCapacity >= 0 && draftCapacity <= 250
                const savedAllocations = tutor.programme_allocations.length
                  ? tutor.programme_allocations.map((row) => `${row.programme_code}:${row.capacity}`).sort().join('|')
                  : initialAllocations(tutor, programmes).map((row) => `${row.programmeCode}:${row.capacity}`).sort().join('|')
                const draftAllocations = draft.allocations.map((row) => `${row.programmeCode}:${Number(row.capacity)}`).sort().join('|')
                const allocationTotal = draft.allocations.reduce((sum, row) => sum + Number(row.capacity || 0), 0)
                const validAllocations = draft.allocations.length > 0
                  && draft.allocations.every((row) => row.programmeCode && Number.isInteger(Number(row.capacity)) && Number(row.capacity) >= 0)
                  && new Set(draft.allocations.map((row) => row.programmeCode)).size === draft.allocations.length
                  && allocationTotal === draftCapacity
                const dirty = draftCapacity !== tutor.capacity
                  || draftAllocations !== savedAllocations
                  || draft.onMaternityLeave !== tutor.on_maternity_leave
                  || draft.maternityReturnDate !== (tutor.maternity_return_date ?? '')
                  || draft.deliveryEligible !== tutor.delivery_eligible
                const onLeaveNow = draft.onMaternityLeave && (!draft.maternityReturnDate || new Date(`${draft.maternityReturnDate}T00:00:00Z`) > new Date())
                const effectiveCapacity = onLeaveNow || !tutor.is_active || !draft.deliveryEligible ? 0 : draftCapacity
                const remaining = !tutor.is_active || !draft.deliveryEligible ? 0 : validCapacity ? effectiveCapacity - tutor.current_caseload : tutor.remaining_capacity
                const utilisation = calculateTutorUtilisation({
                  currentLearners: tutor.current_caseload,
                  capacity: draftCapacity,
                  isActive: tutor.is_active,
                  onMaternityLeave: onLeaveNow,
                })
                return (
                  <tr key={tutor.tutor_id} className={`${draft.allocations.length === 0 && tutor.workstream === null && tutor.is_active ? 'unassigned-row' : ''} ${draft.onMaternityLeave && tutor.is_active ? 'maternity-row' : ''} ${tutor.is_new ? 'new-tutor-row' : ''} ${!tutor.is_active ? 'inactive-tutor-row' : ''}`}>
                    <td><strong>{tutor.tutor_name}{tutor.is_new && <span className="new-tutor-pill">New</span>}</strong><small>{tutor.tutor_id}</small>{tutor.first_seen_at && <small>First seen {discoveredFormatter.format(new Date(tutor.first_seen_at))}</small>}</td>
                    <td><div className="tutor-allocation-editor">{draft.allocations.map((allocation, index) => <div className="tutor-allocation-row" key={`${index}:${allocation.programmeCode}`}><select aria-label={`${tutor.tutor_name} allocation ${index + 1} programme`} value={allocation.programmeCode} disabled={!session.is_admin || !tutor.is_active} onChange={(event) => changeAllocation(tutor.tutor_id, index, { programmeCode: event.target.value })}><option value="">Select programme</option>{programmes.filter((programme) => programme.active).map((programme) => <option key={programme.programme_code} value={programme.programme_code}>{programme.display_name} — {programme.workstream}</option>)}</select><input aria-label={`${tutor.tutor_name} allocation ${index + 1} capacity`} type="number" min="0" max="250" value={allocation.capacity} disabled={!session.is_admin || !tutor.is_active} onChange={(event) => changeAllocation(tutor.tutor_id, index, { capacity: event.target.value })} /><button type="button" aria-label={`Remove allocation ${index + 1} for ${tutor.tutor_name}`} disabled={!session.is_admin || !tutor.is_active || draft.allocations.length === 1} onClick={() => removeAllocation(tutor.tutor_id, index)}>×</button></div>)}<div className={`allocation-total ${validAllocations ? 'valid' : 'invalid'}`}><span>{allocationTotal} of {draftCapacity || 0} places allocated</span><button type="button" disabled={!session.is_admin || !tutor.is_active || draft.allocations.length >= programmes.filter((programme) => programme.active).length} onClick={() => addAllocation(tutor.tutor_id)}>+ Add programme</button></div></div></td>
                    <td><strong>{tutor.current_caseload}</strong></td>
                    <td><div className={`capacity-input ${!validCapacity ? 'invalid' : ''}`}><input aria-label={`${tutor.tutor_name} maximum capacity`} type="number" min="0" max="250" step="1" value={draft.capacity} disabled={!session.is_admin || !tutor.is_active} onChange={(event) => changeDraft(tutor.tutor_id, { capacity: event.target.value })} /><span>learners</span></div></td>
                    <td><label className="maternity-toggle"><input aria-label={`${tutor.tutor_name} delivery tutor`} type="checkbox" checked={draft.deliveryEligible} disabled={!session.is_admin || !tutor.is_active} onChange={(event) => changeDraft(tutor.tutor_id, { deliveryEligible: event.target.checked })} /><span>{draft.deliveryEligible ? 'Delivery' : 'Non-delivery'}</span></label></td>
                    <td><label className="maternity-toggle"><input aria-label={`${tutor.tutor_name} on maternity leave`} type="checkbox" checked={draft.onMaternityLeave} disabled={!session.is_admin || !tutor.is_active} onChange={(event) => changeDraft(tutor.tutor_id, { onMaternityLeave: event.target.checked })} /><span>{draft.onMaternityLeave ? 'On leave' : 'Available'}</span></label></td>
                    <td><input className="return-month-input" aria-label={`${tutor.tutor_name} maternity return month`} type="month" value={draft.maternityReturnDate ? draft.maternityReturnDate.slice(0, 7) : ''} disabled={!session.is_admin || !tutor.is_active || !draft.onMaternityLeave} onChange={(event) => changeDraft(tutor.tutor_id, { maternityReturnDate: event.target.value ? `${event.target.value}-01` : '' })} /></td>
                    <td><span className={`tutor-status-pill ${tutor.is_active ? 'active' : 'inactive'}`}>{tutor.is_active ? 'Active' : 'Inactive'}</span>{tutor.status_updated_by && <small>by {tutor.status_updated_by}</small>}</td>
                    <td>{tutor.is_active ? <strong className={remaining < 0 ? 'negative' : ''}>{remaining}</strong> : <span className="excluded-capacity">Excluded</span>}</td>
                    <td><span className={`tutor-utilisation-pill ${utilisation.tone}`} title={utilisation.percent === null ? utilisation.label : `${tutor.current_caseload} of ${draftCapacity} learner places`}>{utilisation.label}</span></td>
                    <td><span className={`configuration-pill ${tutor.workstream_source}`}>{sourceLabel(tutor.workstream_source)}</span>{tutor.is_new && <small className="review-required">Review required</small>}{tutor.updated_by && <small>by {tutor.updated_by}</small>}</td>
                    <td><div className="tutor-row-actions"><button className="save-tutor-button" disabled={!session.is_admin || !tutor.is_active || !dirty || !validAllocations || !validCapacity || savingId !== null || acknowledgingId !== null || statusUpdatingId !== null} onClick={() => saveTutor(tutor)}>{savingId === tutor.tutor_id ? 'Saving…' : savedId === tutor.tutor_id ? 'Saved' : 'Save'}</button><button className={`tutor-status-button ${tutor.is_active ? 'deactivate' : 'reactivate'}`} disabled={!session.is_admin || savingId !== null || acknowledgingId !== null || statusUpdatingId !== null} onClick={() => updateTutorStatus(tutor)}>{statusUpdatingId === tutor.tutor_id ? 'Updating…' : tutor.is_active ? 'Deactivate' : 'Reactivate'}</button>{tutor.is_new && <button className="acknowledge-tutor-button" disabled={!session.is_admin || savingId !== null || acknowledgingId !== null || statusUpdatingId !== null} onClick={() => acknowledgeTutor(tutor)}>{acknowledgingId === tutor.tutor_id ? 'Acknowledging…' : 'Acknowledge'}</button>}</div></td>
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

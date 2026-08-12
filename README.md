# Skills 4 Capacity Tracker

An Azure-hosted internal application for forecasting tutor capacity across Dental, Pharmacy, Housing, Science, Business, and Operations.

## Stack

- React and TypeScript frontend (`frontend`)
- FastAPI backend (`backend`)
- PostgreSQL for Capacity Tracker-owned data
- Azure Container Apps for the web application and nightly forecast job

The Attendance Tool is always treated as a read-only source. Capacity Tracker migrations and writes must target Capacity Tracker-owned infrastructure only.

## Tutor administration

The Tutors tab reads the active tutor directory from Attendance and stores all
capacity and workstream changes in the Capacity-owned
`capacity.tutor_setting` table. Changes are effective-dated and record the
signed-in administrator in `updated_by`; no tutor data is written to Attendance.

Administrative writes are protected by Azure Container Apps Easy Auth. The dev
registration is `Skills4 Capacity Tracker Dev` (application ID
`bbf24e58-dbf1-4bac-a532-44cb96eb925c`). Anonymous users can view the dashboard,
but the API trusts identity headers only when `CAPACITY_AUTH_ENABLED=true` and
permits writes only for object IDs in `CAPACITY_ADMIN_OBJECT_IDS`. The Easy Auth
client credential is stored by Container Apps, is not part of this repository,
and must be rotated before 11 August 2027.

The narrowly scoped Attendance managed-identity scripts are kept separately in
`backend/migrations/attendance`. They must be run by the Attendance server's
configured Microsoft Entra administrator: script `001` against `postgres`, then
scripts `002` and `003` against `attendance`. They grant `SELECT` only on
`public.learner_progress` and `public.tutors` and enforce read-only transactions
for this identity in the Attendance database.

## Local development

Run the API from `backend`:

```powershell
..\.venv\Scripts\python -m uvicorn app.main:app --reload
```

Run the frontend from `frontend`:

```powershell
npm run dev
```

The frontend falls back to an embedded demonstration forecast when the API is unavailable.

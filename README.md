# Skills 4 Capacity Tracker

An Azure-hosted internal application for forecasting tutor capacity across Dental, Pharmacy, Housing, and Science.

## Stack

- React and TypeScript frontend (`frontend`)
- FastAPI backend (`backend`)
- PostgreSQL for Capacity Tracker-owned data
- Azure Container Apps for the web application and nightly forecast job

The Attendance Tool is always treated as a read-only source. Capacity Tracker migrations and writes must target Capacity Tracker-owned infrastructure only.

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

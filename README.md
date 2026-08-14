# Skills 4 Capacity Tracker

An Azure-hosted internal application for forecasting tutor capacity across Dental, Pharmacy, Housing, Science, and Business.

Operations remains an assignable administrative workstream, but Operations tutors
and learners are excluded from all dashboard, capacity, utilisation, forecast, and
staffing calculations.

The Forecast tab includes a temporary scenario modeller. Users can override the
projected active learner total for each month and calculated workstream; staffing
requirements update immediately using current effective capacity and 50 places per
additional tutor. Scenario values are browser-local state and are never persisted.

## Predictive forecasting

The Predictive Forecasting tab estimates future starts and active learner demand
from up to 36 complete months of Attendance start-date history. It blends recent
demand with seasonal history, limits the effect of short-term trends, uses scheduled
end dates and typical programme duration for projected offboarding, and presents
P50, P80, and P90 planning ranges. P80 is the default prudent staffing view.

Known pipeline starts form a minimum forecast where they exceed the statistical
estimate. Staffing is calculated independently by reporting workstream using current
effective tutor capacity and 50 learner places per additional tutor. Operations is
excluded. The screen also displays model-confidence grades and source-data warnings;
these predictions are planning estimates rather than guaranteed outcomes.

### Projection mathematics

All calculations are performed independently for each reporting workstream. Let
`x_t` be the number of learner starts in historical month `t`. The model uses the
latest 36 **complete** months; the current partial month and future-dated starts are
not included in model training.

#### 1. Limit historical outliers

The start history is winsorised before its seasonal and recent averages are taken.
For historical values `x`:

```text
m   = median(x)
MAD = median(|x - m|)
μ   = mean(x)

upper_bound = max(percentile90(x), m + 3 × max(MAD, √(μ + 1)))
bounded_x_t = min(x_t, upper_bound)
```

This prevents a single unusually large intake month from controlling every future
projection while retaining genuine recurring seasonal peaks.

#### 2. Seasonal and recent-demand baseline

For forecast month `h`, `R` is the mean of the latest six bounded monthly start
counts. `S_h` uses the same calendar month from the previous one, two, and three
years, weighted toward the most recent year:

```text
R   = mean(last 6 bounded months)
S_h = weighted_mean(same month 1, 2 and 3 years ago; weights 0.6, 0.3, 0.1)
```

Weights are renormalised when fewer than three corresponding months exist. If no
same-month history exists, `S_h = R`.

#### 3. Capped trend adjustment and P50 starts

`P` is the mean of the six months immediately before the recent six-month window.
The recent trend ratio is restricted to between `0.75` and `1.25`, so the model can
apply no more than a 25% downward or upward trend. Only half of that capped trend is
introduced progressively over the first 12 forecast months:

```text
trend_ratio    = clamp(R / P, 0.75, 1.25)
trend_strength = 0.5 × min((h + 1) / 12, 1)
trend_factor   = 1 + (trend_ratio - 1) × trend_strength

P50_starts_h = round(max(0, (0.7 × S_h + 0.3 × R) × trend_factor))
```

If `P = 0`, the ratio is `1.25` when recent demand is positive and `1.0` otherwise.

#### 4. P80 and P90 planning ranges

The model measures historical year-on-year error using
`d_t = x_t - x_(t-12)`. Its robust residual scale is:

```text
residual_scale = 1.4826 × MAD(d) / √2
σ = max(1, √(P50_starts_h + 0.5), residual_scale)

P80_starts_h = max(P50_starts_h, ceil(P50_starts_h + 1.282 × σ))
P90_starts_h = max(P80_starts_h, ceil(P50_starts_h + 1.645 × σ))
```

When 12-month differences are unavailable, `MAD(x)` is used for the residual scale.
P50 is the central estimate; P80 and P90 are increasingly cautious planning ranges,
not guarantees that an exact probability will be achieved.

#### 5. Apply known pipeline starts

Known Bud/CRM pipeline starts form a floor rather than being added to the statistical
forecast, which avoids counting the same expected demand twice. For confidence level
`k` (`P50`, `P80`, or `P90`):

```text
forecast_starts_(h,k) = max(statistical_starts_(h,k), known_pipeline_starts_h)
```

#### 6. Convert starts into active learner demand

Typical programme duration `D` is the median number of months between learner start
and expected end dates within the workstream. Individual durations are limited to
3–60 months; the fallback is 18 months when no usable duration exists.

Existing learners count in month `h` when their dates overlap that month and their
status consumes capacity. On-break learners do not consume capacity.

```text
existing_active_h = count(distinct learners where
                          start_date <= month_end_h and
                          expected_end_date >= month_start_h)

forecast_cohorts_(h,k) = sum(forecast_starts_(j,k))
                         for all j <= h where (h - j) < D

predicted_active_(h,k) = existing_active_h + forecast_cohorts_(h,k)
```

#### 7. Capacity gap and additional tutors

Effective capacity is the sum of current tutor capacity settings in that workstream.
A tutor marked as on maternity leave contributes zero effective capacity. Operations
tutors and learners contribute nothing. Capacity is held constant over the forecast
horizon until future-dated staffing settings are implemented.

```text
effective_capacity = sum(effective tutor capacities in the workstream)
remaining_capacity_(h,k) = effective_capacity - predicted_active_(h,k)

additional_tutors_(h,k) =
    ceil(max(0, predicted_active_(h,k) - effective_capacity) / 50)
```

The peak tutor requirement is the maximum monthly value, and the first shortage month
is the earliest month where `additional_tutors_(h,k) > 0`.

#### 8. Data-confidence grade

The workstream grade describes the amount of training evidence, not the probability
band selected by the user:

```text
High   = at least 24 observed months and at least 200 historical starts
Medium = at least 12 observed months and at least 50 historical starts
Low    = anything below the Medium thresholds
```

The endpoint is `GET /api/v1/predictive-forecast`. It reads Attendance and current
Capacity configuration but does not write to either database and requires no schema
migration.

## Stack

- React and TypeScript frontend (`frontend`)
- FastAPI backend (`backend`)
- PostgreSQL for Capacity Tracker-owned data
- Azure Container Apps for the web application and nightly forecast job

The Attendance Tool is always treated as a read-only source. Capacity Tracker migrations and writes must target Capacity Tracker-owned infrastructure only.

## Tutor administration

The Tutors tab reads the active tutor directory from Attendance and stores all
capacity, workstream, and maternity-leave changes in the Capacity-owned
`capacity.tutor_setting` table. Changes are effective-dated and record the
signed-in administrator in `updated_by`; no tutor data is written to Attendance.
Capacity may be set from 0 to 250. A maternity-leave flag preserves the configured
capacity but temporarily sets the tutor's effective forecast capacity to zero until
an administrator clears the flag.

Attendance occasionally exposes the same tutor once with an internal fallback ID
and once with a proper external ID. Capacity Tracker consolidates that unambiguous
alias pattern onto the external ID and carries forward the latest saved Capacity
setting; people who merely share a name are not merged.
When the learner feed uses a Bud tutor ID that is absent from the active tutor
directory, it is reconciled by normalized tutor name only when that name identifies
exactly one active tutor. Ambiguous names are deliberately left unmatched.

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

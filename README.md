# Skills 4 Capacity Tracker

An Azure-hosted internal application for forecasting tutor capacity across Dental, Pharmacy, Housing, Science, and Business.

Operations remains an assignable administrative workstream, but Operations tutors
and learners are excluded from all dashboard, capacity, utilisation, forecast, and
staffing calculations.

Dashboard workstream cards show monthly utilisation as
`projected workstream learners / effective workstream capacity * 100`, rounded to one
decimal place. The All workstreams figure is calculated from total demand divided by
total capacity, so it is capacity weighted rather than an average of percentages.
For a selected month, projected learners are the maximum daily caseload in that
month, while capacity is the tutor allocation effective on the **first day** of
that month; it is not a day-by-day capacity denominator. The four headline cards
and workstream cards also show a separate current snapshot as of the forecast's
generation date: capacity-consuming Attendance learners represented in the forecast and active on that date,
capacity available on that exact date, remaining places, and utilisation. Known
pipeline and planned starters are excluded from this current-learner snapshot.
Attendance learners use `public.learners.planned_end_date` as their capacity
release date when it is on or after their start date; a missing or pre-start
practical date falls back to `public.learner_progress.expected_end_date` (end of
programme). The source status `In End Point Assessment` is preserved as EPA
but does not consume tutor capacity. This applies to tutor caseloads, dashboard
and utilisation, the rolling forecast, and predictive existing demand. Historical
learner-start counts remain historical starts.
The Pharmacy (general) dashboard card is hidden; its filter remains available on
other screens, while Pharmacy (all), Pharmacy L2, and Pharmacy L3 remain visible.
When a dashboard capacity scenario is open, each available tutor's scenario maximum
is distributed across their existing workstream/programme allocations. Tutors with
zero effective capacity remain unavailable, and a tutor teaching two workstreams
counts once in the staff total. Headline demand includes allocated and unallocated
learners and does not change when the tutor-directory search is used. Demand with
zero capacity is labelled
`No capacity` rather than `0% utilised`.

The Utilisation tab's 6-, 12-, and 18-month horizons remove months earlier than the
user's current calendar month before applying the selected horizon. For example, a
six-month view opened in September runs from September through February rather than
retaining August as its first column.

Named month selectors include up to three months preceding the user's current month;
in September this makes June, July, and August selectable and labels them as prior
months. The API adds these retrospective rows without shortening the configured
18-month forward forecast. Planning horizons on Forecast and Utilisation remain
anchored to the current month. Retrospective figures are reconstructed from the
latest read-only Attendance snapshot and effective-dated Capacity settings; they are
not stored month-end snapshots.

The Forecast tab includes a temporary scenario modeller. Users can override the
projected active learner total for each month and calculated workstream; staffing
requirements update immediately using current effective capacity and 50 places per
additional tutor. Scenario values are browser-local state and are never persisted.

## Predictive forecasting

Administrators can maintain planned starts for every programme and month in an
academic year (September through August), together with a programme-specific
duration of 3–60 months. For each programme, its planned intake and known Bud/CRM
pipeline are minimums; the parent workstream cannot forecast fewer starts than
the sum of its programme forecasts:

```text
programme_starts_k = max(programme_statistical_starts_k,
                         programme_pipeline_starts, programme_planned_starts,
                         future_dated_Attendance_starts)
workstream_starts_k = max(workstream_statistical_starts_k,
                          workstream_pipeline_starts, workstream_planned_starts,
                          future_dated_Attendance_starts,
                          sum(programme_starts_k) + unclassified_known_starts)
```

Programme cohorts remain active for their own configured duration. Any excess
workstream-level statistical or unclassified starts use the workstream duration
(the start-weighted planned duration where a plan exists, otherwise the configured
average). Thus Pharmacy L2, Pharmacy L3, and Technical Services planning remains
distinct. Future-dated Attendance starters are already included in existing active
learners, so they are subtracted from projected cohorts to prevent double counting.
Aggregate starts can exceed the displayed programme sum when source history or
pipeline has no programme classification. Plans are stored in the
Capacity database only.

The rolling forecast also uses the planned-cohort count as a *minimum* for each
programme/month. It creates only the difference after already known Attendance
and Bud/CRM starts, so a plan is not added twice. Those additional learners stay
in demand for that programme's configured duration. Confirmed planned tutors with
programme allocations contribute capacity from their start month through their
end month; tentative or cancelled planned tutors do not. Existing Attendance tutors
linked to a planned tutor record are not counted twice. Planned tutors whose
programme allocations do not sum to their maximum capacity are excluded and logged
until corrected. The Forecast tab labels these figures as available/confirmed staff,
not staff already employed today. Attendance remains read-only.

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
programme_starts_(h,k) = max(programme_statistical_starts_(h,k),
                              programme_pipeline_starts_h,
                              programme_planned_starts_h,
                              future_dated_Attendance_starts_h)
workstream_starts_(h,k) = max(workstream_statistical_starts_(h,k),
                              workstream_pipeline_starts_h,
                              workstream_planned_starts_h,
                              future_dated_Attendance_starts_h,
                              sum(programme_starts_(h,k)) + unclassified_known_starts_h)
```

#### 6. Convert starts into active learner demand

Typical programme duration `D` is the median number of months between learner start
and expected end dates within the workstream. Individual durations are limited to
3–60 months; the fallback is 18 months when no usable duration exists.

Existing learners count in month `h` when their dates overlap that month and their
status consumes capacity. On-break and EPA learners do not consume capacity.

```text
existing_active_h = count(distinct learners where
                          start_date <= month_end_h and
                          capacity_end_date >= month_start_h)

forecast_cohorts_(h,k) = sum(programme_starts_(j,k)
                             - future_dated_Attendance_starts_j) for each programme
                         while (h - j) < that programme's configured duration
                         + residual workstream starts, less unclassified
                           future-dated Attendance starts, while (h - j) < D

predicted_active_(h,k) = existing_active_h + forecast_cohorts_(h,k)
```

#### 7. Capacity gap and additional tutors

Effective capacity is the sum of tutor capacity settings in that workstream. A tutor
marked as on maternity leave contributes zero until the configured return month,
when their saved capacity is restored. This rule also applies to programme
allocations: a zero-capacity tutor cannot regain capacity through an allocation.
Confirmed planned tutors enter and leave capacity on their configured dates.
Operations tutors and learners contribute nothing. Other current tutor settings
remain constant over the forecast horizon.

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

### Manual predictive scenario

The Predictive Forecasting tab can apply browser-local monthly movements for each
reporting workstream. Users can enter Starters, Breaks in Learning (`BiL`), returns
from BiL, Withdrawn (`WD`), and Out of Funding (`OOF`). Blank Starters retain the
selected P50/P80/P90 prediction; entering `0` explicitly overrides it with no starts.

For an entered month:

```text
net_learner_movement = Starters + BiL_Returns - BiL - WD - OOF
starter_adjustment = Manual_Starters - Model_Starters
```

The starter adjustment remains active for the workstream's median programme
duration. BiL, WD, and OOF reductions carry into subsequent months; a BiL return
offsets the accumulated BiL reduction. For forecast month `h`:

```text
scenario_active_h = max(
    0,
    model_active_h
    + sum(active starter adjustments through h)
    + cumulative_BiL_Returns_h
    - cumulative_BiL_h
    - cumulative_WD_h
    - cumulative_OOF_h
)

remaining_capacity_h = effective_capacity - scenario_active_h

additional_tutors_h =
    ceil(max(0, scenario_active_h - effective_capacity) / 50)
```

The UI highlights months where exits exceed the available forecast population and
caps the resulting active count at zero. A BiL return greater than breaks entered in
the scenario is allowed with a warning because the break may have started before the
forecast window. Scenario values are held only in the current React session and are
never written to Attendance or the Capacity database.

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

Tutor capacity can be divided across multiple programme allocations. The allocation
total must equal the tutor's maximum capacity, which prevents the same learner places
from being counted more than once. Pharmacy L2, Pharmacy L3, Technical Services, and
general programme buckets for the other workstreams are separate choices. A tutor
with 50 places can therefore hold, for example, 20 Pharmacy L2 places and 30 Pharmacy
L3 places, or split those places across programmes belonging to different
workstreams. Forecast and utilisation calculations aggregate each allocation only
into its programme's parent workstream; multi-workstream tutors appear once in each
relevant workstream with the allocated share of capacity.

The Tutors tab reads the active tutor directory from Attendance and stores all
capacity, workstream, and maternity-leave changes in the Capacity-owned
`capacity.tutor_setting` table. Changes are effective-dated and record the
signed-in administrator in `updated_by`; no tutor data is written to Attendance.
Capacity may be set from 0 to 250. A maternity-leave flag preserves the configured
capacity but temporarily sets the tutor's effective forecast capacity to zero. An
optional return month restores that capacity from the first day of the selected
month. Administrators can also mark a person as non-delivery; this removes their
headcount and capacity from every calculation while retaining their active learners
as demand requiring reassignment.

The tutor directory calculates each tutor's current utilisation as
`current learners / maximum capacity * 100`, rounded to one decimal place. It uses
draft capacity and maternity-leave values so the display updates before saving. A
tutor with zero capacity or on maternity leave is shown as `Unavailable`; an inactive
tutor is shown as `Excluded`. Utilisation may exceed 100% when caseload is above the
configured maximum.

Administrators can also deactivate or reactivate a tutor from the Tutors tab. Status
changes are effective-dated in the Capacity-owned `capacity.tutor_status` table and
record the administrator and update time. An inactive tutor remains visible in the
directory for review and reactivation, but contributes no tutor headcount, available
capacity, utilisation denominator, or forecast staffing. Their active learners are
retained as unallocated demand so the app continues to show the learner places and
replacement tutors required. Migration
`backend/migrations/005_add_tutor_status.sql` creates this audit history; it makes no
change to Attendance.

Migration `backend/migrations/006_programme_and_workforce_planning.sql` creates the
programme catalogue, multi-programme tutor-allocation structure, planned tutor,
planned cohort, and cohort reservation structures. It also adds maternity return
dates and delivery eligibility to effective-dated tutor settings. The Utilisation
grid exposes a synchronized horizontal scrollbar above the table so long horizons
can be navigated without first scrolling to the final tutor row.

Attendance occasionally exposes the same tutor once with an internal fallback ID
and once with a proper external ID. Capacity Tracker consolidates that unambiguous
alias pattern onto the external ID and carries forward the latest saved Capacity
setting; people who merely share a name are not merged.
When the learner feed uses a Bud tutor ID that is absent from the active tutor
directory, it is reconciled by normalized tutor name only when that name identifies
exactly one active tutor. Ambiguous names are deliberately left unmatched.
Renamed or historic identities that cannot be reconciled safely by those rules are
stored explicitly in the Capacity-owned `capacity.tutor_identity_alias` table. The
alias is applied before caseload, utilisation, forecast, and tutor-directory
calculations, while the active Attendance tutor remains the canonical record.
Migration `backend/migrations/010_add_tutor_identity_aliases.sql` creates this table
and seeds the confirmed Elouise Frost external identity to Ellie Frost's active
Attendance identity. Attendance is not modified.

### New tutor discovery

Capacity Tracker maintains a Capacity-owned discovery ledger in
`capacity.tutor_discovery`; Attendance remains a read-only source. The app checks the
canonical active Attendance tutor roster plus tutor identities on current,
capacity-consuming learner assignments when the app opens, whenever the Tutors tab
loads, and every five minutes while the app is open. This second source catches a
new tutor whose Bud learner assignments arrive before their record appears in
`public.tutors`. Each tutor has a first-seen, last-seen, active, and acknowledgement
audit state. Tutors found after the baseline are shown in the Tutors navigation
badge, the dashboard alert, and the Tutors tab's `New` filter until an administrator
acknowledges them.

Migration `backend/migrations/004_add_tutor_discovery.sql` creates the ledger and its
singleton baseline marker. Its first successful non-empty scan records the existing
active roster as an acknowledged `system-baseline`, preventing a deployment from
reporting every existing tutor as new. An empty first scan is rejected rather than
initializing an unreliable baseline.

Saving a new tutor's workstream/capacity settings acknowledges that tutor in the same
Capacity database transaction. Administrators can also acknowledge a tutor without
changing settings. A genuinely unassigned tutor is excluded from forecast
calculations until a workstream is assigned; a tutor whose workstream can be inferred
from learners uses the normal default capacity of 50 but remains visibly flagged for
review. Source-only tutors can be configured or deactivated in the same way as roster
tutors. They default to non-delivery with zero effective capacity and do not add
forecast capacity until an administrator explicitly confirms and saves their Capacity
Tracker configuration. No discovery or acknowledgement action writes to Attendance.

Administrative writes are protected by Azure Container Apps Easy Auth. The dev
registration is `Skills4 Capacity Tracker Dev` (application ID
`bbf24e58-dbf1-4bac-a532-44cb96eb925c`). Anonymous users can view the dashboard,
but the API trusts identity headers only when `CAPACITY_AUTH_ENABLED=true` and
permits writes only for authorised Microsoft Entra Object IDs. IDs in
`CAPACITY_ADMIN_OBJECT_IDS` remain the bootstrap administrators. An existing
administrator can open the Settings tab and promote a user who has signed in to the
app at least once. The first authenticated session automatically records the user's
Entra Object ID, name, email, and first/last-seen timestamps in the Capacity-owned
`capacity.app_user` directory. Object IDs remain internal, so administrators select
people by name rather than looking them up in Azure. Additional authorisations are
stored in `capacity.admin_user`, take effect on the user's next request, and use the
same Easy Auth sign-in; no application password or separate account is created.
Database administrators can be removed in Settings, but a bootstrap administrator
must be removed from the Azure app configuration. The app prevents administrators
from removing their own access. Migrations
`backend/migrations/008_add_admin_users.sql` and
`backend/migrations/009_add_app_user_directory.sql` create the Capacity-owned access
and user-directory tables.
The Easy Auth client credential is stored by Container Apps, is not part of this
repository, and must be rotated before 11 August 2027.

The narrowly scoped Attendance managed-identity scripts are kept separately in
`backend/migrations/attendance`. They must be run by the Attendance server's
configured Microsoft Entra administrator: script `001` against `postgres`, then
scripts `002`, `003`, and `004` against `attendance`. They grant `SELECT` only on
`public.learner_progress`, `public.tutors`, and `public.cohorts` and enforce
read-only transactions for this identity in the Attendance database. Cohort access
is used solely to show each tutor's current active-cohort count.
The practical-end-date integration also requires script `005`, which grants
column-level `SELECT` on `public.learners.learner_ref`, `planned_end_date`, and
`deleted_at`. This grant was explicitly approved and applied to the dev Attendance
database; it does not grant access to learner contact details or write access.

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

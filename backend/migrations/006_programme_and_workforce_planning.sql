-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

BEGIN;

ALTER TABLE capacity.tutor_setting
    ADD COLUMN IF NOT EXISTS maternity_return_date date,
    ADD COLUMN IF NOT EXISTS delivery_eligible boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS capacity.programme (
    programme_code text PRIMARY KEY,
    display_name text NOT NULL UNIQUE,
    workstream_code text NOT NULL REFERENCES capacity.workstream(workstream_code),
    level text,
    default_duration_months integer NOT NULL DEFAULT 18,
    active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT 'migration-006',
    CONSTRAINT programme_duration_range CHECK (default_duration_months BETWEEN 3 AND 60)
);

CREATE TABLE IF NOT EXISTS capacity.programme_alias (
    alias_key text PRIMARY KEY,
    programme_code text NOT NULL REFERENCES capacity.programme(programme_code),
    source_system text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL DEFAULT 'migration-006'
);

INSERT INTO capacity.programme (
    programme_code, display_name, workstream_code, default_duration_months
)
SELECT programme_key, programme_name, workstream_code, 18
FROM capacity.programme_workstream
ON CONFLICT DO NOTHING;

INSERT INTO capacity.programme_alias (alias_key, programme_code)
SELECT lower(trim(programme_name)), programme_key
FROM capacity.programme_workstream
ON CONFLICT (alias_key) DO NOTHING;

INSERT INTO capacity.programme (
    programme_code, display_name, workstream_code, level, default_duration_months
)
VALUES
    ('pharmacy-l2', 'Pharmacy L2', 'pharmacy', 'L2', 15),
    ('pharmacy-l3', 'Pharmacy L3', 'pharmacy', 'L3', 18),
    ('technical-services', 'Technical Services', 'pharmacy', NULL, 18)
ON CONFLICT (programme_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS capacity.tutor_programme_assignment (
    tutor_programme_assignment_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attendance_tutor_id text NOT NULL,
    tutor_name text NOT NULL,
    programme_code text NOT NULL REFERENCES capacity.programme(programme_code),
    allocated_capacity integer NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT tutor_programme_capacity_range CHECK (allocated_capacity BETWEEN 0 AND 250),
    CONSTRAINT tutor_programme_effective_range CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    ),
    UNIQUE (attendance_tutor_id, programme_code, effective_from)
);

CREATE INDEX IF NOT EXISTS tutor_programme_assignment_current_idx
    ON capacity.tutor_programme_assignment (
        attendance_tutor_id, programme_code, effective_from DESC
    )
    WHERE effective_to IS NULL;

CREATE TABLE IF NOT EXISTS capacity.planned_tutor (
    planned_tutor_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tutor_name text NOT NULL,
    attendance_tutor_id text,
    start_date date NOT NULL,
    end_date date,
    max_learners integer NOT NULL DEFAULT 50,
    status text NOT NULL DEFAULT 'planned',
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT planned_tutor_capacity_range CHECK (max_learners BETWEEN 0 AND 250),
    CONSTRAINT planned_tutor_date_range CHECK (end_date IS NULL OR end_date >= start_date),
    CONSTRAINT planned_tutor_status CHECK (status IN ('planned', 'confirmed', 'cancelled'))
);

CREATE TABLE IF NOT EXISTS capacity.planned_tutor_programme (
    planned_tutor_id bigint NOT NULL REFERENCES capacity.planned_tutor(planned_tutor_id) ON DELETE CASCADE,
    programme_code text NOT NULL REFERENCES capacity.programme(programme_code),
    allocated_capacity integer NOT NULL,
    PRIMARY KEY (planned_tutor_id, programme_code),
    CONSTRAINT planned_tutor_programme_capacity_range CHECK (allocated_capacity BETWEEN 0 AND 250)
);

CREATE TABLE IF NOT EXISTS capacity.planned_cohort (
    planned_cohort_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    academic_year text NOT NULL,
    programme_code text NOT NULL REFERENCES capacity.programme(programme_code),
    start_month date NOT NULL,
    planned_starts integer NOT NULL,
    status text NOT NULL DEFAULT 'planned',
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT planned_cohort_month_start CHECK (start_month = date_trunc('month', start_month)::date),
    CONSTRAINT planned_cohort_starts_nonnegative CHECK (planned_starts >= 0),
    CONSTRAINT planned_cohort_status CHECK (status IN ('planned', 'confirmed', 'cancelled')),
    UNIQUE (programme_code, start_month)
);

CREATE TABLE IF NOT EXISTS capacity.cohort_capacity_allocation (
    cohort_capacity_allocation_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    planned_cohort_id bigint NOT NULL REFERENCES capacity.planned_cohort(planned_cohort_id) ON DELETE CASCADE,
    attendance_tutor_id text,
    planned_tutor_id bigint REFERENCES capacity.planned_tutor(planned_tutor_id),
    reserved_places integer NOT NULL,
    notes text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT cohort_reserved_places_positive CHECK (reserved_places > 0),
    CONSTRAINT cohort_allocation_one_tutor CHECK (
        (attendance_tutor_id IS NOT NULL AND planned_tutor_id IS NULL)
        OR (attendance_tutor_id IS NULL AND planned_tutor_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS planned_cohort_start_idx
    ON capacity.planned_cohort (start_month, programme_code)
    WHERE status <> 'cancelled';

COMMIT;

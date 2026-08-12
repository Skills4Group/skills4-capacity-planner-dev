-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

CREATE SCHEMA IF NOT EXISTS capacity;

CREATE TABLE capacity.workstream (
    workstream_code text PRIMARY KEY,
    display_name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT valid_workstream CHECK (
        display_name IN ('Dental', 'Pharmacy', 'Housing', 'Science', 'Business', 'Operations')
    )
);

INSERT INTO capacity.workstream (workstream_code, display_name)
VALUES
    ('dental', 'Dental'),
    ('pharmacy', 'Pharmacy'),
    ('housing', 'Housing'),
    ('science', 'Science'),
    ('business', 'Business'),
    ('operations', 'Operations')
ON CONFLICT DO NOTHING;

CREATE TABLE capacity.programme_workstream (
    programme_key text PRIMARY KEY,
    programme_name text NOT NULL,
    workstream_code text NOT NULL REFERENCES capacity.workstream(workstream_code),
    effective_from date NOT NULL DEFAULT CURRENT_DATE,
    effective_to date,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT programme_effective_range CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE TABLE capacity.tutor_setting (
    tutor_setting_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    attendance_tutor_id text NOT NULL,
    tutor_name text NOT NULL,
    workstream_code text NOT NULL REFERENCES capacity.workstream(workstream_code),
    max_learners integer NOT NULL DEFAULT 50 CHECK (max_learners BETWEEN 1 AND 250),
    effective_from date NOT NULL,
    effective_to date,
    active boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT tutor_effective_range CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    ),
    UNIQUE (attendance_tutor_id, effective_from)
);

CREATE TABLE capacity.pipeline_learner (
    pipeline_learner_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_system text NOT NULL CHECK (source_system IN ('BUD', 'CRM')),
    source_learner_id text NOT NULL,
    programme_key text,
    programme_name text NOT NULL,
    workstream_code text NOT NULL REFERENCES capacity.workstream(workstream_code),
    expected_start_date date NOT NULL,
    expected_end_date date NOT NULL,
    pipeline_status text NOT NULL,
    source_updated_at timestamptz,
    synced_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT pipeline_date_range CHECK (expected_end_date >= expected_start_date),
    UNIQUE (source_system, source_learner_id)
);

CREATE INDEX pipeline_learner_forecast_idx
    ON capacity.pipeline_learner (workstream_code, expected_start_date, expected_end_date);

CREATE TABLE capacity.forecast_run (
    forecast_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    as_of_date date NOT NULL,
    horizon_months integer NOT NULL DEFAULT 18 CHECK (horizon_months BETWEEN 1 AND 36),
    generated_at timestamptz NOT NULL DEFAULT now(),
    source_synced_at timestamptz,
    settings_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE capacity.forecast_allocation (
    forecast_run_id bigint NOT NULL REFERENCES capacity.forecast_run(forecast_run_id) ON DELETE CASCADE,
    learner_key text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('attendance', 'pipeline')),
    attendance_tutor_id text,
    workstream_code text NOT NULL REFERENCES capacity.workstream(workstream_code),
    start_date date NOT NULL,
    end_date date NOT NULL,
    allocation_status text NOT NULL CHECK (allocation_status IN ('assigned', 'modelled', 'unallocated')),
    PRIMARY KEY (forecast_run_id, learner_key)
);

CREATE TABLE capacity.sync_run (
    sync_run_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_system text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
    records_read integer NOT NULL DEFAULT 0,
    records_written integer NOT NULL DEFAULT 0,
    error_summary text
);

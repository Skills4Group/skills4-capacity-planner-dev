-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

BEGIN;

CREATE TABLE IF NOT EXISTS capacity.tutor_status (
    attendance_tutor_id text NOT NULL,
    tutor_name text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    effective_from date NOT NULL,
    effective_to date,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    PRIMARY KEY (attendance_tutor_id, effective_from),
    CONSTRAINT tutor_status_effective_range CHECK (
        effective_to IS NULL OR effective_to >= effective_from
    )
);

CREATE INDEX IF NOT EXISTS tutor_status_current_idx
    ON capacity.tutor_status (attendance_tutor_id, effective_from DESC)
    WHERE effective_to IS NULL;

COMMIT;

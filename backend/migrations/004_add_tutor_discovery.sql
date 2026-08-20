-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

BEGIN;

CREATE TABLE IF NOT EXISTS capacity.tutor_discovery_state (
    state_key text PRIMARY KEY,
    initialized_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tutor_discovery_singleton CHECK (state_key = 'active-tutor-baseline')
);

CREATE TABLE IF NOT EXISTS capacity.tutor_discovery (
    attendance_tutor_id text PRIMARY KEY,
    tutor_name text NOT NULL,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by text,
    active_in_attendance boolean NOT NULL DEFAULT true,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tutor_discovery_acknowledgement CHECK (
        (acknowledged_at IS NULL AND acknowledged_by IS NULL)
        OR acknowledged_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS tutor_discovery_new_active_idx
    ON capacity.tutor_discovery (first_seen_at, attendance_tutor_id)
    WHERE active_in_attendance IS TRUE AND acknowledged_at IS NULL;

COMMIT;

-- Capacity Tracker-owned schema only. Attendance is not modified.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.admin_user (
    entra_object_id uuid PRIMARY KEY,
    display_name text NOT NULL,
    email text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT admin_user_display_name_present CHECK (length(trim(display_name)) > 0),
    CONSTRAINT admin_user_email_present CHECK (email IS NULL OR length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS admin_user_active_idx
    ON capacity.admin_user (active, display_name);

COMMIT;

-- Capacity Tracker-owned Entra user directory. Attendance is not modified.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.app_user (
    entra_object_id uuid PRIMARY KEY,
    display_name text NOT NULL,
    email text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_user_display_name_present CHECK (length(trim(display_name)) > 0),
    CONSTRAINT app_user_email_present CHECK (email IS NULL OR length(trim(email)) > 0)
);

CREATE INDEX IF NOT EXISTS app_user_last_seen_idx
    ON capacity.app_user (last_seen_at DESC);

COMMIT;

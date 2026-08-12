-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

BEGIN;

ALTER TABLE capacity.tutor_setting
    ADD COLUMN IF NOT EXISTS on_maternity_leave boolean NOT NULL DEFAULT false;

ALTER TABLE capacity.tutor_setting
    DROP CONSTRAINT IF EXISTS tutor_setting_max_learners_check;

ALTER TABLE capacity.tutor_setting
    DROP CONSTRAINT IF EXISTS tutor_setting_capacity_range;

ALTER TABLE capacity.tutor_setting
    ADD CONSTRAINT tutor_setting_capacity_range
    CHECK (max_learners BETWEEN 0 AND 250);

COMMIT;

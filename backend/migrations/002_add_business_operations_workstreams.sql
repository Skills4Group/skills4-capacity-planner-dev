-- Capacity Tracker-owned schema only.
-- This migration must run against the dedicated Capacity Tracker database,
-- never against the Attendance Tool database.

BEGIN;

ALTER TABLE capacity.workstream
    DROP CONSTRAINT IF EXISTS valid_workstream;

ALTER TABLE capacity.workstream
    ADD CONSTRAINT valid_workstream CHECK (
        display_name IN (
            'Dental',
            'Pharmacy',
            'Housing',
            'Science',
            'Business',
            'Operations'
        )
    );

INSERT INTO capacity.workstream (workstream_code, display_name)
VALUES
    ('business', 'Business'),
    ('operations', 'Operations')
ON CONFLICT (workstream_code) DO UPDATE
SET display_name = EXCLUDED.display_name;

COMMIT;

-- Optional fixed monthly staffing assumption for the private scenario.
-- Capacity-owned only; Attendance remains read-only.
BEGIN;

ALTER TABLE capacity.private_model_assumption
    ADD COLUMN IF NOT EXISTS staffed_tutors integer
    CHECK (staffed_tutors BETWEEN 0 AND 10000);

COMMIT;

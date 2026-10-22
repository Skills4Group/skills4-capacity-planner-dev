-- Requires explicit approval before execution against Attendance.
-- Capacity Tracker needs only these columns to match a learner and read the
-- planned practical end date; no Attendance writes are granted.

BEGIN;

GRANT SELECT (learner_ref, planned_end_date, deleted_at)
ON TABLE public.learners
TO "s4capdevmwhe4psk55o7s-identity";

COMMIT;

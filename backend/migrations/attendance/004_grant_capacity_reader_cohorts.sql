-- Run against the Attendance server's `attendance` database.
-- Adds only the cohort read needed for the Tutor directory's active-cohort count.

BEGIN;

GRANT SELECT ON TABLE public.cohorts
TO "s4capdevmwhe4psk55o7s-identity";

COMMIT;

-- Run against the Attendance server's `attendance` database after
-- 001_create_capacity_reader.sql succeeds.
--
-- These are the only Attendance permissions required by Capacity Tracker.

BEGIN;

GRANT CONNECT ON DATABASE attendance
TO "s4capdevmwhe4psk55o7s-identity";

GRANT USAGE ON SCHEMA public
TO "s4capdevmwhe4psk55o7s-identity";

GRANT SELECT ON TABLE public.learner_progress, public.tutors
TO "s4capdevmwhe4psk55o7s-identity";

ALTER ROLE "s4capdevmwhe4psk55o7s-identity"
IN DATABASE attendance
SET default_transaction_read_only = on;

COMMIT;

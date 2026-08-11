-- Run against the Attendance `attendance` database. Every result should be
-- true and the final setting should contain default_transaction_read_only=on.

SELECT
    has_database_privilege(
        's4capdevmwhe4psk55o7s-identity',
        'attendance',
        'CONNECT'
    ) AS can_connect,
    has_schema_privilege(
        's4capdevmwhe4psk55o7s-identity',
        'public',
        'USAGE'
    ) AS can_use_public,
    has_table_privilege(
        's4capdevmwhe4psk55o7s-identity',
        'public.learner_progress',
        'SELECT'
    ) AS can_read_learner_progress,
    has_table_privilege(
        's4capdevmwhe4psk55o7s-identity',
        'public.tutors',
        'SELECT'
    ) AS can_read_tutors;

SELECT settings.setconfig
FROM pg_db_role_setting settings
JOIN pg_roles roles ON roles.oid = settings.setrole
JOIN pg_database databases ON databases.oid = settings.setdatabase
WHERE roles.rolname = 's4capdevmwhe4psk55o7s-identity'
  AND databases.datname = 'attendance';

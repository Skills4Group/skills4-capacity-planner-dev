-- Run against the Attendance server's `postgres` database while signed in as
-- its configured Microsoft Entra administrator.
--
-- This creates only the Capacity Tracker managed-identity principal. It does
-- not alter Attendance tables, schemas, or application data.

SELECT pgaadauth_create_principal_with_oid(
    's4capdevmwhe4psk55o7s-identity',
    '83100eb8-7efc-4803-8e54-61a4075f17df',
    'service',
    false,
    false
)
WHERE NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 's4capdevmwhe4psk55o7s-identity'
);

-- Capacity Tracker-owned seed data only. Attendance is not modified.
BEGIN;

INSERT INTO capacity.programme (
    programme_code, display_name, workstream_code, default_duration_months,
    updated_by
)
VALUES
    ('dental-general', 'Dental (general)', 'dental', 18, 'migration-007'),
    ('pharmacy-general', 'Pharmacy (general)', 'pharmacy', 18, 'migration-007'),
    ('housing-general', 'Housing (general)', 'housing', 18, 'migration-007'),
    ('science-general', 'Science (general)', 'science', 18, 'migration-007'),
    ('business-general', 'Business (general)', 'business', 18, 'migration-007'),
    ('operations-general', 'Operations (general)', 'operations', 18, 'migration-007')
ON CONFLICT DO NOTHING;

COMMIT;

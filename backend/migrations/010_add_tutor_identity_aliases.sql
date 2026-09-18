-- Capacity-owned tutor identity reconciliation. Attendance remains read only.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.tutor_identity_alias (
    alias_tutor_id text PRIMARY KEY,
    canonical_tutor_id text NOT NULL,
    alias_tutor_name text,
    canonical_tutor_name text NOT NULL,
    reason text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT tutor_identity_alias_ids_differ CHECK (
        btrim(alias_tutor_id) <> btrim(canonical_tutor_id)
    ),
    CONSTRAINT tutor_identity_alias_id_present CHECK (
        length(btrim(alias_tutor_id)) > 0
        AND length(btrim(canonical_tutor_id)) > 0
    ),
    CONSTRAINT tutor_identity_alias_name_present CHECK (
        alias_tutor_name IS NULL OR length(btrim(alias_tutor_name)) > 0
    ),
    CONSTRAINT tutor_identity_canonical_name_present CHECK (
        length(btrim(canonical_tutor_name)) > 0
    )
);

CREATE INDEX IF NOT EXISTS tutor_identity_alias_canonical_idx
    ON capacity.tutor_identity_alias (canonical_tutor_id)
    WHERE active IS TRUE;

INSERT INTO capacity.tutor_identity_alias (
    alias_tutor_id,
    canonical_tutor_id,
    alias_tutor_name,
    canonical_tutor_name,
    reason,
    active,
    updated_by
)
VALUES (
    '423CEC9E-0471-40A5-9ADB-B43C00F63258',
    'attendance-internal:19',
    'Elouise Frost',
    'Ellie Frost',
    'Attendance learner feed uses Elouise/external identity while active tutor roster uses Ellie/internal identity',
    true,
    'system-migration-010'
)
ON CONFLICT (alias_tutor_id)
DO UPDATE SET
    canonical_tutor_id = EXCLUDED.canonical_tutor_id,
    alias_tutor_name = EXCLUDED.alias_tutor_name,
    canonical_tutor_name = EXCLUDED.canonical_tutor_name,
    reason = EXCLUDED.reason,
    active = true,
    updated_at = now(),
    updated_by = EXCLUDED.updated_by;

COMMIT;

-- Private model access is Capacity-owned. Attendance remains read-only.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.private_model_grant (
    entra_object_id uuid PRIMARY KEY REFERENCES capacity.app_user(entra_object_id),
    active boolean NOT NULL DEFAULT true,
    granted_at timestamptz NOT NULL DEFAULT now(),
    granted_by uuid NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL
);

GRANT SELECT, INSERT, UPDATE ON capacity.private_model_grant
    TO "s4capdevmwhe4psk55o7s-identity";

COMMIT;

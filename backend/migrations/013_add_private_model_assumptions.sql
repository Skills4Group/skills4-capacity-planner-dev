-- Private financial scenario settings belong only to Capacity Tracker.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.private_model_assumption (
    model_id integer PRIMARY KEY CHECK (model_id = 1),
    effective_month date NOT NULL CHECK (EXTRACT(day FROM effective_month) = 1),
    cohort_size integer NOT NULL CHECK (cohort_size BETWEEN 1 AND 250),
    monthly_tutor_cost numeric(12, 2) CHECK (monthly_tutor_cost >= 0),
    average_contract_value numeric(12, 2) CHECK (average_contract_value >= 0),
    enrolment_drop_percent numeric(5, 2) NOT NULL
        CHECK (enrolment_drop_percent BETWEEN 0 AND 100),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by uuid NOT NULL
);

GRANT SELECT, INSERT, UPDATE ON capacity.private_model_assumption
    TO "s4capdevmwhe4psk55o7s-identity";

COMMIT;

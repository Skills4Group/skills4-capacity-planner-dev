-- Shared monthly planning assumptions. Attendance remains read-only.
BEGIN;

CREATE TABLE IF NOT EXISTS capacity.predictive_movement_rate (
    month date PRIMARY KEY,
    bil_percent numeric(5,2) NOT NULL DEFAULT 4.00
        CHECK (bil_percent >= 0 AND bil_percent <= 100),
    oof_percent numeric(5,2) NOT NULL DEFAULT 4.00
        CHECK (oof_percent >= 0 AND oof_percent <= 100),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by text NOT NULL,
    CONSTRAINT predictive_movement_month_first_day CHECK (EXTRACT(DAY FROM month) = 1),
    CONSTRAINT predictive_movement_combined_rate CHECK (bil_percent + oof_percent <= 100)
);

GRANT SELECT, INSERT, UPDATE ON capacity.predictive_movement_rate
    TO "s4capdevmwhe4psk55o7s-identity";

COMMIT;

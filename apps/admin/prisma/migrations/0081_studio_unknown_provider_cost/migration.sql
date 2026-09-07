-- A provider that does not report money has an unknown charge, never a fabricated zero.
ALTER TABLE studio_experiment_candidate ALTER COLUMN actual_cost_micros DROP NOT NULL;

CREATE TABLE studio_experiment_selection (
 id TEXT PRIMARY KEY,
 experiment_id TEXT NOT NULL REFERENCES studio_experiment(id) ON DELETE RESTRICT,
 candidate_key TEXT NOT NULL REFERENCES studio_experiment_candidate(candidate_key) ON DELETE RESTRICT,
 request_key TEXT NOT NULL UNIQUE,
 input_hash TEXT NOT NULL,
 asset JSONB NOT NULL,
 actor JSONB NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX studio_experiment_selection_experiment_id_created_at_idx ON studio_experiment_selection(experiment_id,created_at);
CREATE TRIGGER studio_selection_immutable BEFORE UPDATE OR DELETE ON studio_experiment_selection FOR EACH ROW EXECUTE FUNCTION studio_retain_asset_version();
CREATE FUNCTION studio_capture_selection_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.asset,'STUDIO_EXPERIMENT_SELECTION',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER studio_selection_usage AFTER INSERT ON studio_experiment_selection FOR EACH ROW EXECUTE FUNCTION studio_capture_selection_usage();

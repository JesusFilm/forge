CREATE TABLE studio_production_run (
 id TEXT PRIMARY KEY, attempt_id VARCHAR(128) UNIQUE REFERENCES studio_attempt(id) ON DELETE RESTRICT,
 experiment_id TEXT UNIQUE REFERENCES studio_experiment(id) ON DELETE RESTRICT,
 actor JSONB NOT NULL, max_cost_micros BIGINT NOT NULL CHECK(max_cost_micros BETWEEN 0 AND 100000000),
 state TEXT NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','CANCELLED','COMPLETED')),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((attempt_id IS NOT NULL)::int + (experiment_id IS NOT NULL)::int = 1)
);
CREATE TABLE studio_production_call (
 run_id TEXT NOT NULL REFERENCES studio_production_run(id) ON DELETE RESTRICT,
 key TEXT NOT NULL CHECK(length(key) <= 128), input_digest VARCHAR(64) NOT NULL,
 reserve_micros BIGINT NOT NULL CHECK(reserve_micros >= 0),
 state TEXT NOT NULL DEFAULT 'RUNNING' CHECK(state IN ('RUNNING','COMPLETED','FAILED','AMBIGUOUS')),
 result JSONB, PRIMARY KEY(run_id,key)
);
CREATE FUNCTION studio_guard_production_run() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state <> 'READY' OR (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') THEN RAISE EXCEPTION 'Production admission is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_production_run_guard BEFORE UPDATE OR DELETE ON studio_production_run FOR EACH ROW EXECUTE FUNCTION studio_guard_production_run();
CREATE FUNCTION studio_guard_production_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state <> 'RUNNING' OR (to_jsonb(NEW)-ARRAY['state','result']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','result']) THEN RAISE EXCEPTION 'Paid execution is consumed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_production_call_guard BEFORE UPDATE OR DELETE ON studio_production_call FOR EACH ROW EXECUTE FUNCTION studio_guard_production_call();
CREATE FUNCTION studio_capture_production_call() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.result,'STUDIO_PRODUCTION_CALL',NEW.run_id || ':' || NEW.key); RETURN NEW; END $$;
CREATE TRIGGER studio_production_call_usage AFTER INSERT OR UPDATE ON studio_production_call FOR EACH ROW EXECUTE FUNCTION studio_capture_production_call();

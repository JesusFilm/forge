CREATE TABLE studio_mux_job (
 id TEXT PRIMARY KEY,
 attempt_id VARCHAR(128) UNIQUE NOT NULL REFERENCES studio_attempt(id) ON DELETE RESTRICT,
 snapshot JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DISPATCHING','AMBIGUOUS','PROCESSING','READY','FAILED')),
 dispatch_id TEXT UNIQUE,
 asset_id TEXT UNIQUE,
 readiness JSONB,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION studio_guard_mux_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.attempt_id<>OLD.attempt_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
 OR NEW.created_at<>OLD.created_at OR (OLD.dispatch_id IS NOT NULL AND NEW.dispatch_id IS DISTINCT FROM OLD.dispatch_id)
 OR (OLD.asset_id IS NOT NULL AND NEW.asset_id IS DISTINCT FROM OLD.asset_id)
 OR (NEW.state='PENDING' AND OLD.state<>'PENDING')
 OR (OLD.state IN ('READY','FAILED') AND NEW.state<>OLD.state)
 THEN RAISE EXCEPTION 'Mux admission and consumed dispatch are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_mux_job_guard BEFORE UPDATE OR DELETE ON studio_mux_job FOR EACH ROW EXECUTE FUNCTION studio_guard_mux_job();
CREATE FUNCTION studio_retain_mux_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.snapshot,'STUDIO_MUX_JOB',NEW.id); RETURN NEW; END $$;
CREATE TRIGGER studio_mux_job_retain AFTER INSERT ON studio_mux_job FOR EACH ROW EXECUTE FUNCTION studio_retain_mux_job();

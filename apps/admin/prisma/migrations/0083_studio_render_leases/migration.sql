CREATE TABLE studio_render_job (
 attempt_id VARCHAR(128) PRIMARY KEY REFERENCES studio_attempt(id) ON DELETE RESTRICT,
 snapshot JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','COMPLETED','CANCELLED','FAILED')),
 generation INTEGER NOT NULL DEFAULT 0 CHECK(generation BETWEEN 0 AND 3),
 lease_id TEXT, lease_expires_at TIMESTAMP(3),
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION studio_guard_render_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state IN ('COMPLETED','CANCELLED','FAILED')
 OR NEW.attempt_id<>OLD.attempt_id OR NEW.snapshot IS DISTINCT FROM OLD.snapshot OR NEW.created_at<>OLD.created_at
 OR NEW.generation<OLD.generation OR NEW.generation>OLD.generation+1
 THEN RAISE EXCEPTION 'Render admission and terminal job are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER studio_render_job_guard BEFORE UPDATE OR DELETE ON studio_render_job FOR EACH ROW EXECUTE FUNCTION studio_guard_render_job();
CREATE FUNCTION studio_retain_render_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.snapshot,'STUDIO_RENDER_JOB',NEW.attempt_id); RETURN NEW; END $$;
CREATE TRIGGER studio_render_job_retain AFTER INSERT ON studio_render_job FOR EACH ROW EXECUTE FUNCTION studio_retain_render_job();

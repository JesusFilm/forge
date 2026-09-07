CREATE TABLE studio_render_lease (
 attempt_id VARCHAR(128) NOT NULL REFERENCES studio_render_job(attempt_id) ON DELETE RESTRICT,
 lease_id TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 3),
 expires_at TIMESTAMP(3) NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(attempt_id,lease_id),
 UNIQUE(attempt_id,generation)
);
CREATE TABLE studio_render_execution (
 attempt_id VARCHAR(128) NOT NULL REFERENCES studio_render_job(attempt_id) ON DELETE RESTRICT,
 lease_id TEXT NOT NULL,
 request_hash VARCHAR(64) NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUCCEEDED','FAILED','CANCELLED')),
 result JSONB NOT NULL,
 admitted BOOLEAN NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(attempt_id,lease_id),
 FOREIGN KEY(attempt_id,lease_id) REFERENCES studio_render_lease(attempt_id,lease_id) ON DELETE RESTRICT
);
CREATE FUNCTION studio_guard_render_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Render execution results are immutable'; END $$;
CREATE TRIGGER studio_render_execution_guard BEFORE UPDATE OR DELETE ON studio_render_execution FOR EACH ROW EXECUTE FUNCTION studio_guard_render_execution();
CREATE FUNCTION studio_retain_render_execution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM studio_retain_references(NEW.result,'STUDIO_RENDER_EXECUTION',NEW.attempt_id||':'||NEW.lease_id); RETURN NEW; END $$;
CREATE TRIGGER studio_render_execution_retain AFTER INSERT ON studio_render_execution FOR EACH ROW EXECUTE FUNCTION studio_retain_render_execution();

CREATE TRIGGER studio_render_lease_guard BEFORE UPDATE OR DELETE ON studio_render_lease FOR EACH ROW EXECUTE FUNCTION studio_guard_render_execution();

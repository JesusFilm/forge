-- Worker materialization is immutable lease evidence, never a human revision edit.
CREATE TABLE short_render_preparation (
  attempt_id VARCHAR(128) NOT NULL,
  lease_id TEXT NOT NULL,
  input_hash VARCHAR(64) NOT NULL,
  document JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id, lease_id),
  FOREIGN KEY (attempt_id, lease_id) REFERENCES short_render_lease(attempt_id, lease_id) ON DELETE RESTRICT
);
CREATE FUNCTION short_render_preparation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Render preparation is immutable'; END IF;
 IF NOT EXISTS (SELECT 1 FROM short_attempt a JOIN short_render_job j ON j.attempt_id=a.id
   JOIN short_render_lease l ON l.attempt_id=j.attempt_id AND l.lease_id=j.lease_id
   WHERE a.id=NEW.attempt_id AND a.kind='RENDER' AND a.status='RUNNING'
   AND j.state='RUNNING' AND j.lease_id=NEW.lease_id AND a.input_hash=NEW.input_hash
   AND l.expires_at > (now() AT TIME ZONE 'UTC'))
 THEN RAISE EXCEPTION 'Current issued render lease required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER short_render_preparation_guard BEFORE INSERT OR UPDATE OR DELETE ON short_render_preparation
 FOR EACH ROW EXECUTE FUNCTION short_render_preparation_guard();
CREATE FUNCTION short_render_preparation_retain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.document,'SHORT_RENDER_PREPARATION',NEW.attempt_id||':'||NEW.lease_id);
 RETURN NEW;
END $$;
CREATE TRIGGER short_render_preparation_retain AFTER INSERT ON short_render_preparation
 FOR EACH ROW EXECUTE FUNCTION short_render_preparation_retain();

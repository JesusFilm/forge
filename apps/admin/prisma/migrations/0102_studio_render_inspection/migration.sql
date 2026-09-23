-- Advisory measurements of exact retained output; never approval or publication.
CREATE TABLE short_render_inspection (
  attempt_id VARCHAR(128) NOT NULL REFERENCES short_attempt(id) ON DELETE RESTRICT,
  version VARCHAR(128) NOT NULL,
  output_version_id TEXT NOT NULL REFERENCES short_asset_version(id) ON DELETE RESTRICT,
  evidence JSONB NOT NULL CHECK (octet_length(evidence::text) <= 460000),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attempt_id, version)
);
CREATE TRIGGER short_render_inspection_immutable BEFORE UPDATE OR DELETE ON short_render_inspection
 FOR EACH ROW EXECUTE FUNCTION short_guard_render_execution();
CREATE FUNCTION short_render_inspection_retain() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM short_retain_references(NEW.evidence->'output', 'SHORT_RENDER_INSPECTION', NEW.attempt_id||':'||NEW.version);
 RETURN NEW;
END $$;
CREATE TRIGGER short_render_inspection_retain AFTER INSERT ON short_render_inspection
 FOR EACH ROW EXECUTE FUNCTION short_render_inspection_retain();

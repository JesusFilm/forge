CREATE TABLE studio_project (
  id VARCHAR(128) PRIMARY KEY,
  current_revision INTEGER NOT NULL CHECK (current_revision > 0),
  owner_id VARCHAR(128) NOT NULL,
  lifecycle VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle IN ('DRAFT','PUBLISHED','UNPUBLISHED')),
  first_published_at TIMESTAMP(3), unpublished_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((lifecycle = 'DRAFT' AND first_published_at IS NULL AND unpublished_at IS NULL)
    OR (lifecycle = 'PUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at IS NULL)
    OR (lifecycle = 'UNPUBLISHED' AND first_published_at IS NOT NULL AND unpublished_at IS NOT NULL))
);
CREATE TABLE studio_project_revision (
  project_id VARCHAR(128) NOT NULL REFERENCES studio_project(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  number INTEGER NOT NULL CHECK (number > 0), document JSONB NOT NULL CHECK (octet_length(document::text) <= 524288),
  actor JSONB NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (project_id, number)
);
ALTER TABLE studio_project ADD CONSTRAINT studio_current_revision_fk
  FOREIGN KEY (id, current_revision) REFERENCES studio_project_revision(project_id, number) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE studio_command (
  project_id VARCHAR(128) NOT NULL REFERENCES studio_project(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  idempotency_key VARCHAR(128) NOT NULL, input_hash VARCHAR(64) NOT NULL,
  actor JSONB NOT NULL, result JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(project_id, idempotency_key)
);

CREATE TABLE studio_attempt (
  id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, base_revision INTEGER NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('GENERATION','NARRATION','RENDER')),
  status VARCHAR(16) NOT NULL DEFAULT 'QUEUED' CHECK(status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED','CANCELLED','STALE')),
  input_hash VARCHAR(64) NOT NULL, actor JSONB NOT NULL, instructions JSONB NOT NULL,
  result JSONB CHECK (octet_length(result::text) <= 65536), job_reference VARCHAR(128), completed_by JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP(3) NOT NULL,
  FOREIGN KEY(project_id,base_revision) REFERENCES studio_project_revision(project_id,number) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX studio_attempt_project_id_created_at_idx ON studio_attempt(project_id,created_at);

CREATE TABLE studio_approval (
  id VARCHAR(128) PRIMARY KEY, project_id VARCHAR(128) NOT NULL, revision INTEGER NOT NULL,
  kind VARCHAR(16) NOT NULL CHECK(kind IN ('SCRIPT','PUBLICATION')), dependency_hash VARCHAR(64) NOT NULL,
  actor JSONB NOT NULL CHECK(actor->>'kind' = 'human'), render_attempt_id VARCHAR(128) REFERENCES studio_attempt(id),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id,revision) REFERENCES studio_project_revision(project_id,number) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ((kind = 'SCRIPT' AND render_attempt_id IS NULL) OR (kind = 'PUBLICATION' AND render_attempt_id IS NOT NULL))
);
CREATE INDEX studio_approval_project_id_kind_dependency_hash_idx ON studio_approval(project_id,kind,dependency_hash);

-- Revision/approval/receipt evidence is append-only, independent of API callers.
CREATE FUNCTION studio_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Studio evidence is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER studio_revision_immutable BEFORE UPDATE OR DELETE ON studio_project_revision
  FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE TRIGGER studio_approval_immutable BEFORE UPDATE OR DELETE ON studio_approval
  FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();
CREATE TRIGGER studio_command_immutable BEFORE UPDATE OR DELETE ON studio_command
  FOR EACH ROW EXECUTE FUNCTION studio_reject_evidence_mutation();

CREATE FUNCTION studio_project_latch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Studio project history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Studio project identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.first_published_at IS NOT NULL THEN
    IF OLD.lifecycle <> 'PUBLISHED' OR NEW.lifecycle <> 'UNPUBLISHED'
      OR NEW.first_published_at IS DISTINCT FROM OLD.first_published_at
      OR NEW.current_revision IS DISTINCT FROM OLD.current_revision
      OR NEW.unpublished_at IS NULL THEN
      RAISE EXCEPTION 'Studio publication latch is permanent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle = 'PUBLISHED' THEN
    IF NEW.current_revision <> OLD.current_revision THEN
      RAISE EXCEPTION 'Publish the reviewed revision only' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle <> 'DRAFT' OR NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Studio draft revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER studio_project_latch BEFORE UPDATE OR DELETE ON studio_project
  FOR EACH ROW EXECUTE FUNCTION studio_project_latch();

CREATE FUNCTION studio_require_draft_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE published TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Studio attempt history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  SELECT first_published_at INTO published FROM studio_project WHERE id = NEW.project_id FOR UPDATE;
  IF published IS NOT NULL THEN
    -- Operational completion of work admitted before publication is retained,
    -- but can only become STALE; it cannot start work or modify the composition.
    IF TG_TABLE_NAME <> 'studio_attempt' OR TG_OP <> 'UPDATE' THEN
      RAISE EXCEPTION 'Published Studio content is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'STALE' OR OLD.status NOT IN ('QUEUED','RUNNING')
      OR NEW.job_reference IS DISTINCT FROM OLD.job_reference THEN
      RAISE EXCEPTION 'Only stale completion of admitted work is allowed' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME = 'studio_attempt' AND TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('QUEUED','RUNNING')
      OR (to_jsonb(NEW) - ARRAY['status','result','job_reference','completed_by','updated_at']) IS DISTINCT FROM
         (to_jsonb(OLD) - ARRAY['status','result','job_reference','completed_by','updated_at'])
      OR (OLD.job_reference IS NOT NULL AND NEW.job_reference IS DISTINCT FROM OLD.job_reference)
      OR (OLD.status = 'RUNNING' AND NEW.status = 'QUEUED') THEN
      RAISE EXCEPTION 'Studio attempt identity or terminal result is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER studio_revision_draft BEFORE INSERT ON studio_project_revision
  FOR EACH ROW EXECUTE FUNCTION studio_require_draft_parent();
CREATE TRIGGER studio_approval_draft BEFORE INSERT ON studio_approval
  FOR EACH ROW EXECUTE FUNCTION studio_require_draft_parent();
CREATE TRIGGER studio_attempt_draft BEFORE INSERT OR UPDATE OR DELETE ON studio_attempt
  FOR EACH ROW EXECUTE FUNCTION studio_require_draft_parent();

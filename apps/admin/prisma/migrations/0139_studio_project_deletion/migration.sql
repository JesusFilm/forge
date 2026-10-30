-- Workspace deletion retains immutable revision, render and shared asset evidence.
ALTER TABLE short ADD COLUMN deleted_at TIMESTAMP(3);
CREATE INDEX short_visible_id_idx ON short(id) WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION short_project_latch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Shorts project history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.source_video_dub_id IS DISTINCT FROM OLD.source_video_dub_id THEN
    RAISE EXCEPTION 'Shorts project identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted Shorts projects are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.deleted_at IS NOT NULL THEN
    IF (to_jsonb(NEW) - 'deleted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'deleted_at')
      OR OLD.lifecycle = 'PUBLISHED'
      OR EXISTS (SELECT 1 FROM short_attempt WHERE project_id = OLD.id AND status IN ('QUEUED','RUNNING'))
      OR EXISTS (SELECT 1 FROM short_mux_job job JOIN short_attempt attempt ON attempt.id = job.attempt_id
        WHERE attempt.project_id = OLD.id AND job.state NOT IN ('READY','FAILED'))
      OR EXISTS (SELECT 1 FROM short_production_call call JOIN short_production_run run ON run.id = call.run_id
        JOIN short_attempt attempt ON attempt.id = run.attempt_id
        WHERE attempt.project_id = OLD.id AND call.state IN ('RUNNING','AMBIGUOUS'))
      OR EXISTS (SELECT 1 FROM short_plan_slot WHERE project_id = OLD.id) THEN
      RAISE EXCEPTION 'Shorts project cannot be deleted in its current state' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.first_published_at IS NOT NULL THEN
    IF OLD.lifecycle <> 'PUBLISHED' OR NEW.lifecycle <> 'UNPUBLISHED'
      OR NEW.first_published_at IS DISTINCT FROM OLD.first_published_at
      OR NEW.current_revision IS DISTINCT FROM OLD.current_revision
      OR NEW.unpublished_at IS NULL THEN
      RAISE EXCEPTION 'Shorts publication latch is permanent' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle = 'PUBLISHED' THEN
    IF NEW.current_revision <> OLD.current_revision THEN
      RAISE EXCEPTION 'Publish the reviewed revision only' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.lifecycle <> 'DRAFT' OR NEW.current_revision <> OLD.current_revision + 1 THEN
    RAISE EXCEPTION 'Shorts draft revision must advance exactly once' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
-- Serialize new work with deletion even for callers bypassing service commands.
CREATE FUNCTION short_require_visible_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE removed TIMESTAMP(3);
BEGIN
  SELECT deleted_at INTO removed FROM short WHERE id = NEW.project_id FOR UPDATE;
  IF removed IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted Shorts projects cannot admit work' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER short_revision_visible BEFORE INSERT ON short_revision
  FOR EACH ROW EXECUTE FUNCTION short_require_visible_parent();
CREATE TRIGGER short_approval_visible BEFORE INSERT ON short_approval
  FOR EACH ROW EXECUTE FUNCTION short_require_visible_parent();
CREATE TRIGGER short_attempt_visible BEFORE INSERT OR UPDATE ON short_attempt
  FOR EACH ROW EXECUTE FUNCTION short_require_visible_parent();
CREATE TRIGGER short_calendar_visible BEFORE INSERT OR UPDATE OF project_id ON short_plan_slot
  FOR EACH ROW EXECUTE FUNCTION short_require_visible_parent();

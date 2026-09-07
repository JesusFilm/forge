-- Calendar authorization and attempted delivery are evidence, not mutable draft content.
ALTER TABLE studio_calendar ADD CONSTRAINT studio_calendar_version_positive CHECK (version > 0);
ALTER TABLE studio_plan_slot ADD CONSTRAINT studio_slot_version_nonnegative CHECK (version >= 0);
ALTER TABLE studio_schedule_authorization ADD CONSTRAINT studio_schedule_window CHECK (version > 0 AND latest_allowed_at >= due_at AND latest_allowed_at <= due_at + interval '1 day');
CREATE FUNCTION studio_calendar_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calendar history is retained'; END IF;
  IF TG_TABLE_NAME = 'studio_calendar_command' THEN
    RAISE EXCEPTION 'Calendar receipts are immutable';
  ELSIF TG_TABLE_NAME = 'studio_schedule_authorization' THEN
    IF (to_jsonb(NEW) - ARRAY['revoked_at','consumed_at','submission','outcome']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['revoked_at','consumed_at','submission','outcome'])
       OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
       OR (OLD.consumed_at IS NOT NULL AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
       OR (OLD.submission IS NOT NULL AND NEW.submission IS DISTINCT FROM OLD.submission)
    THEN RAISE EXCEPTION 'Schedule authorization and submitted envelope are immutable'; END IF;
  ELSIF TG_TABLE_NAME = 'studio_planning_run' THEN
    IF (to_jsonb(NEW) - ARRAY['result','status','finished_at']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['result','status','finished_at'])
       OR OLD.status <> 'RUNNING'
    THEN RAISE EXCEPTION 'Planning inputs and terminal results are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER studio_calendar_receipt_guard BEFORE UPDATE OR DELETE ON studio_calendar_command FOR EACH ROW EXECUTE FUNCTION studio_calendar_history_guard();
CREATE TRIGGER studio_schedule_authorization_guard BEFORE UPDATE OR DELETE ON studio_schedule_authorization FOR EACH ROW EXECUTE FUNCTION studio_calendar_history_guard();
CREATE TRIGGER studio_planning_run_guard BEFORE UPDATE OR DELETE ON studio_planning_run FOR EACH ROW EXECUTE FUNCTION studio_calendar_history_guard();

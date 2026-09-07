ALTER TABLE studio_planning_run ADD COLUMN actor jsonb;
CREATE OR REPLACE FUNCTION studio_calendar_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
       OR OLD.status NOT IN ('RUNNING','DISPATCHED')
       OR (OLD.status='DISPATCHED' AND NEW.status='RUNNING')
    THEN RAISE EXCEPTION 'Planning inputs and terminal results are immutable'; END IF;
  END IF;
  RETURN NEW;
END $$;

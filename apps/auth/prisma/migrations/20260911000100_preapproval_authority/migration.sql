ALTER TABLE changelog_preapproval ADD CONSTRAINT preapproval_state
  CHECK (state IN ('pending', 'canceled', 'redeemed'));
ALTER TABLE changelog_preapproval ADD CONSTRAINT preapproval_redemption
  CHECK ((state = 'redeemed' AND redeemed_at IS NOT NULL AND redeemed_by_id IS NOT NULL)
      OR (state <> 'redeemed' AND redeemed_at IS NULL AND redeemed_by_id IS NULL));
ALTER TABLE changelog_preapproval ADD CONSTRAINT preapproval_version CHECK (version >= 0);

-- Authority writers must invalidate a management transaction's old Serializable
-- snapshot, including writers outside the HTTP management service. Acquire rows
-- in stable order. User profile updates do not invoke this trigger.
CREATE FUNCTION touch_preapproval_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_user TEXT; target_environment TEXT;
BEGIN
  IF TG_TABLE_NAME = 'user' THEN
    IF NEW.membership_status IS NOT DISTINCT FROM OLD.membership_status
       AND NEW.actor_type IS NOT DISTINCT FROM OLD.actor_type THEN RETURN NEW; END IF;
    target_user := OLD.id;
  ELSIF TG_TABLE_NAME = 'app_grant' THEN
    target_environment := OLD.environment_id;
  ELSIF TG_TABLE_NAME = 'app_grant_scope' THEN
    IF NOT EXISTS (SELECT 1 FROM scope WHERE id = OLD.scope_id AND key = 'changelog:admin') THEN RETURN OLD; END IF;
    SELECT environment_id INTO target_environment FROM app_grant WHERE id = OLD.grant_id;
  END IF;
  PERFORM e.id FROM app_environment e JOIN registered_app a ON a.id = e.app_id
    WHERE a.key = 'changelog'
      AND (target_environment IS NULL OR e.id = target_environment)
      AND (target_user IS NULL OR EXISTS (SELECT 1 FROM app_grant g WHERE g.environment_id = e.id AND g.user_id = target_user))
    ORDER BY e.id FOR UPDATE OF e;
  UPDATE app_environment e SET updated_at = clock_timestamp()
    FROM registered_app a WHERE a.id = e.app_id AND a.key = 'changelog'
      AND (target_environment IS NULL OR e.id = target_environment)
      AND (target_user IS NULL OR EXISTS (SELECT 1 FROM app_grant g WHERE g.environment_id = e.id AND g.user_id = target_user));
  RETURN OLD;
END $$;

-- Deferred checks observe the final authority of a transaction, so replacing
-- a grant's scope associations atomically does not spuriously cancel approvals.
CREATE FUNCTION cancel_unauthorized_preapprovals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE changelog_preapproval p SET state = 'canceled', version = version + 1, updated_at = clock_timestamp()
  WHERE p.state = 'pending' AND NOT EXISTS (
    SELECT 1 FROM "user" u
    JOIN app_grant g ON g.user_id = u.id
    JOIN app_grant_scope gs ON gs.grant_id = g.id
    JOIN scope s ON s.id = gs.scope_id
    JOIN app_environment e ON e.id = g.environment_id AND e.app_id = g.app_id
    JOIN registered_app a ON a.id = e.app_id
    WHERE u.id = p.approver_id AND u.membership_status = 'active' AND u.actor_type = 'human'
      AND g.environment_id = p.environment_id AND g.subject_type = 'user'
      AND g.status = 'approved' AND g.revoked_at IS NULL AND s.key = 'changelog:admin'
      AND e.status = 'approved' AND a.key = 'changelog' AND a.status = 'active'
  );
  RETURN NULL;
END $$;

-- AFTER triggers preserve NEW values; touch_preapproval_authority's return is ignored.
CREATE TRIGGER preapproval_user_authority AFTER UPDATE OF membership_status, actor_type ON "user"
FOR EACH ROW EXECUTE FUNCTION touch_preapproval_authority();
CREATE TRIGGER preapproval_grant_authority AFTER UPDATE OR DELETE ON app_grant
FOR EACH ROW EXECUTE FUNCTION touch_preapproval_authority();
CREATE TRIGGER preapproval_scope_authority AFTER UPDATE OR DELETE ON app_grant_scope
FOR EACH ROW EXECUTE FUNCTION touch_preapproval_authority();
CREATE TRIGGER preapproval_scope_definition AFTER UPDATE OF key ON scope
FOR EACH ROW EXECUTE FUNCTION touch_preapproval_authority();
CREATE TRIGGER preapproval_app_authority AFTER UPDATE OF status ON registered_app
FOR EACH ROW EXECUTE FUNCTION touch_preapproval_authority();

CREATE CONSTRAINT TRIGGER preapproval_user_loss AFTER UPDATE OR DELETE ON "user" DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();
CREATE CONSTRAINT TRIGGER preapproval_grant_loss AFTER UPDATE OR DELETE ON app_grant DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();
CREATE CONSTRAINT TRIGGER preapproval_scope_loss AFTER UPDATE OR DELETE ON app_grant_scope DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();
CREATE CONSTRAINT TRIGGER preapproval_environment_loss AFTER UPDATE ON app_environment DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();
CREATE CONSTRAINT TRIGGER preapproval_scope_definition_loss AFTER UPDATE ON scope DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();
CREATE CONSTRAINT TRIGGER preapproval_app_loss AFTER UPDATE ON registered_app DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION cancel_unauthorized_preapprovals();

CREATE INDEX preapproval_pending_authority ON changelog_preapproval (approver_id, environment_id) WHERE state = 'pending';

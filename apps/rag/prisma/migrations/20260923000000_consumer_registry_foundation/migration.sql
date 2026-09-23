-- Consumer metadata is deliberately outside the public corpus schema. No
-- serving, corpus-reader, or report role receives privileges in this foundation.
CREATE SCHEMA consumer_private;
REVOKE ALL ON SCHEMA consumer_private FROM PUBLIC;

CREATE TABLE consumer_private.consumers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE CHECK (name ~ '^[a-z0-9-]+$' AND length(name) BETWEEN 1 AND 80),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'active', 'suspended', 'revoked')),
  allowed_source_keys text[] NOT NULL DEFAULT '{}' CHECK (array_position(allowed_source_keys, NULL) IS NULL),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consumer_private.members (
  consumer_id uuid NOT NULL REFERENCES consumer_private.consumers(id) ON DELETE RESTRICT,
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  role text NOT NULL CHECK (role IN ('owner', 'member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_id, github_user_id)
);

-- V1 has one runtime environment per consumer; source grants and lifecycle
-- state belong to consumers. Aggregate-only storage is reserved for feat-528.
CREATE TABLE consumer_private.usage_daily (
  consumer_id uuid NOT NULL REFERENCES consumer_private.consumers(id) ON DELETE RESTRICT,
  day date NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'client_error', 'server_error')),
  request_count bigint NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (consumer_id, day, outcome)
);

CREATE TABLE consumer_private.lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_id uuid NOT NULL REFERENCES consumer_private.consumers(id) ON DELETE RESTRICT,
  actor_github_user_id bigint NOT NULL CHECK (actor_github_user_id > 0),
  action text NOT NULL CHECK (action IN ('created', 'member_added', 'member_removed')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);

-- Identities cannot be recycled or silently renamed; lifecycle operations are
-- introduced by later tickets with their own authority and audit contract.
CREATE FUNCTION consumer_private.guard_consumer_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'consumer identity cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.name IS DISTINCT FROM OLD.name THEN
    RAISE EXCEPTION 'consumer identity cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_consumer_identity BEFORE UPDATE OR DELETE ON consumer_private.consumers
FOR EACH ROW EXECUTE FUNCTION consumer_private.guard_consumer_identity();

-- Serialize membership changes for a consumer before the deferred owner check.
CREATE FUNCTION consumer_private.lock_membership_parent() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.consumer_id IS DISTINCT FROM OLD.consumer_id THEN
    RAISE EXCEPTION 'membership cannot move between consumers';
  END IF;
  PERFORM 1 FROM consumer_private.consumers WHERE id = OLD.consumer_id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lock_membership_parent BEFORE UPDATE OR DELETE ON consumer_private.members
FOR EACH ROW EXECUTE FUNCTION consumer_private.lock_membership_parent();

CREATE FUNCTION consumer_private.require_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'consumers' THEN
    target_id := NEW.id;
  ELSE
    target_id := OLD.consumer_id;
  END IF;
  IF EXISTS (SELECT 1 FROM consumer_private.consumers WHERE id = target_id)
     AND NOT EXISTS (
       SELECT 1 FROM consumer_private.members
       WHERE consumer_id = target_id AND role = 'owner'
     ) THEN
    RAISE EXCEPTION 'consumer requires an owner';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER require_owner_after_create
AFTER INSERT ON consumer_private.consumers DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION consumer_private.require_owner();
CREATE CONSTRAINT TRIGGER require_owner_after_member_change
AFTER UPDATE OR DELETE ON consumer_private.members DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION consumer_private.require_owner();

REVOKE ALL ON ALL TABLES IN SCHEMA consumer_private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA consumer_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA consumer_private REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA consumer_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

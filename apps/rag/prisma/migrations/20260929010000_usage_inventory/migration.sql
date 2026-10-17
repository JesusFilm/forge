-- Maintained independently by deployment operators, never by serving collectors.
CREATE TABLE usage_private.deployment_inventory (
  deployment_id text PRIMARY KEY CHECK(deployment_id ~ '^[A-Za-z0-9-]{1,80}$'),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  expected_replicas integer NOT NULL CHECK(expected_replicas BETWEEN 1 AND 64),
  CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
ALTER TABLE usage_private.collectors ADD COLUMN deployment_id text NOT NULL DEFAULT 'unconfigured';
CREATE OR REPLACE VIEW usage_private.report_collectors AS SELECT * FROM usage_private.collectors;
CREATE VIEW usage_private.report_inventory AS SELECT * FROM usage_private.deployment_inventory;
REVOKE ALL ON usage_private.deployment_inventory, usage_private.report_inventory FROM PUBLIC;
CREATE FUNCTION usage_private.guard_inventory() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.deployment_id IS DISTINCT FROM OLD.deployment_id
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.expected_replicas IS DISTINCT FROM OLD.expected_replicas
     OR OLD.ends_at IS NOT NULL OR NEW.ends_at IS NULL THEN
    RAISE EXCEPTION 'inventory permits only one terminal close';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guard_inventory BEFORE UPDATE ON usage_private.deployment_inventory
FOR EACH ROW EXECUTE FUNCTION usage_private.guard_inventory();
REVOKE ALL ON FUNCTION usage_private.guard_inventory() FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA usage_private REVOKE ALL ON FUNCTIONS FROM PUBLIC;

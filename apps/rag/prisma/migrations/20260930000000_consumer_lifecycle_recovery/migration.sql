-- Keep identity, audit, and usage for reporting, while releasing deleted names.
ALTER TABLE consumer_private.consumers
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN lifecycle_version bigint NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0);
ALTER TABLE consumer_private.consumers DROP CONSTRAINT consumers_name_key;
CREATE UNIQUE INDEX consumers_live_name_uq ON consumer_private.consumers(name)
  WHERE deleted_at IS NULL;
ALTER TABLE consumer_private.consumers DROP CONSTRAINT consumers_state_check;
ALTER TABLE consumer_private.consumers
  ADD CONSTRAINT consumers_state_check CHECK (
    (state IN ('pending', 'active', 'suspended', 'revoked') AND deleted_at IS NULL)
    OR (state = 'deleted' AND deleted_at IS NOT NULL)
  );
ALTER TABLE consumer_private.lifecycle_audit DROP CONSTRAINT lifecycle_audit_action_check;
ALTER TABLE consumer_private.lifecycle_audit ADD CONSTRAINT lifecycle_audit_action_check
  CHECK (action IN (
    'created', 'member_added', 'member_removed', 'credential_issued',
    'credential_rotated', 'suspended', 'resumed', 'revoked', 'denied',
    'allowlist_revision_applied', 'recovery', 'recovered', 'deleted'
  ));

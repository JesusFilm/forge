-- Keep the globally reserved consumer name through revoke and restore.
ALTER TABLE consumer_private.consumers
  ADD COLUMN lifecycle_version bigint NOT NULL DEFAULT 1 CHECK (lifecycle_version > 0);
ALTER TABLE consumer_private.lifecycle_audit DROP CONSTRAINT lifecycle_audit_action_check;
ALTER TABLE consumer_private.lifecycle_audit ADD CONSTRAINT lifecycle_audit_action_check
  CHECK (action IN (
    'created', 'member_added', 'member_removed', 'credential_issued',
    'credential_rotated', 'suspended', 'resumed', 'revoked', 'denied',
    'allowlist_revision_applied', 'recovery', 'recovered'
  ));

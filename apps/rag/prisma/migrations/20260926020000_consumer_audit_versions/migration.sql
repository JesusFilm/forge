ALTER TABLE consumer_private.lifecycle_audit
  ADD COLUMN membership_version bigint CHECK (membership_version > 0),
  ADD COLUMN credential_version bigint CHECK (credential_version > 0);

CREATE TABLE consumer_private.allowlist_revisions (
  sha char(40) PRIMARY KEY CHECK (sha ~ '^[0-9a-f]{40}$'),
  applied_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON consumer_private.allowlist_revisions FROM PUBLIC;

ALTER TABLE consumer_private.lifecycle_audit
  DROP CONSTRAINT lifecycle_audit_action_check;
ALTER TABLE consumer_private.lifecycle_audit
  ADD CONSTRAINT lifecycle_audit_action_check CHECK (action IN (
    'created', 'member_added', 'member_removed', 'credential_issued',
    'credential_rotated', 'suspended', 'resumed', 'revoked', 'denied',
    'allowlist_revision_applied', 'recovery'
  ));

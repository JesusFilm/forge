ALTER TABLE consumer_private.lifecycle_audit
  ADD COLUMN target_github_user_id bigint CHECK (target_github_user_id > 0),
  ADD COLUMN admission_sha char(40) CHECK (admission_sha ~ '^[0-9a-f]{40}$');

ALTER TABLE consumer_private.lifecycle_audit
  DROP CONSTRAINT lifecycle_audit_action_check;
ALTER TABLE consumer_private.lifecycle_audit
  ADD CONSTRAINT lifecycle_audit_action_check CHECK (action IN (
    'created', 'member_added', 'member_removed', 'credential_issued',
    'credential_rotated', 'suspended', 'resumed', 'revoked', 'denied'
  ));

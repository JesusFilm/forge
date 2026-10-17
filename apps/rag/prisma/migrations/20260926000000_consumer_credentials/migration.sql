-- Credential verifiers and lifecycle versions stay outside the corpus schema.
ALTER TABLE consumer_private.consumers
  ADD COLUMN credential_version bigint NOT NULL DEFAULT 0 CHECK (credential_version >= 0),
  ADD COLUMN membership_version bigint NOT NULL DEFAULT 1 CHECK (membership_version >= 1);

CREATE TABLE consumer_private.credentials (
  consumer_id uuid PRIMARY KEY REFERENCES consumer_private.consumers(id) ON DELETE RESTRICT,
  verifier char(64) NOT NULL UNIQUE CHECK (verifier ~ '^[0-9a-f]{64}$'),
  version bigint NOT NULL CHECK (version > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

ALTER TABLE consumer_private.lifecycle_audit
  DROP CONSTRAINT lifecycle_audit_action_check;
ALTER TABLE consumer_private.lifecycle_audit
  ADD CONSTRAINT lifecycle_audit_action_check CHECK (action IN (
    'created', 'member_added', 'member_removed', 'credential_issued',
    'credential_rotated', 'suspended', 'resumed', 'revoked'
  ));

REVOKE ALL ON consumer_private.credentials FROM PUBLIC;

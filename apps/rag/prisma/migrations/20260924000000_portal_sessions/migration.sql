-- A separate portal role must be granted only USAGE on this schema and
-- SELECT/INSERT/DELETE on these tables. Corpus/retrieval roles receive nothing.
CREATE SCHEMA portal_private;
REVOKE ALL ON SCHEMA portal_private FROM PUBLIC;
CREATE TABLE portal_private.oauth_states (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE portal_private.sessions (
  token_hash text PRIMARY KEY,
  github_user_id bigint NOT NULL CHECK (github_user_id > 0),
  github_login text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX portal_sessions_expires_idx ON portal_private.sessions (expires_at);
REVOKE ALL ON ALL TABLES IN SCHEMA portal_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal_private REVOKE ALL ON TABLES FROM PUBLIC;

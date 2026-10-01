-- Empty, default-off delegated refresh authority. No source retention changes.
SET lock_timeout = '1000ms';
SET statement_timeout = '15000ms';
BEGIN;
CREATE TABLE recommendation_cowatch_refresh_grant (
  id uuid PRIMARY KEY,
  anchor_release_id uuid NOT NULL,
  anchor_pointer_generation integer NOT NULL CHECK (anchor_pointer_generation > 0),
  influence_floor_generation integer NOT NULL CHECK (influence_floor_generation >= 0),
  manifest_digest char(64) NOT NULL CHECK (manifest_digest ~ '^[a-f0-9]{64}$'),
  configuration_digest char(64) NOT NULL CHECK (configuration_digest ~ '^[a-f0-9]{64}$'),
  policy_version varchar(64) NOT NULL CHECK (policy_version = 'cowatch-refresh-seven-day-mature-v1'),
  budget jsonb NOT NULL CHECK (jsonb_typeof(budget) = 'object' AND octet_length(budget::text) <= 8192),
  approved_by_id varchar(191) NOT NULL CHECK (length(approved_by_id) > 0),
  approved_at timestamp(3) NOT NULL,
  valid_until timestamp(3) NOT NULL CHECK (valid_until = approved_at + interval '29 days'),
  revoked_at timestamp(3),
  revocation_reason varchar(64),
  CHECK ((revoked_at IS NULL AND revocation_reason IS NULL) OR (revoked_at IS NOT NULL AND revocation_reason IS NOT NULL))
);
CREATE UNIQUE INDEX recommendation_cowatch_refresh_one_live_grant ON recommendation_cowatch_refresh_grant ((true)) WHERE revoked_at IS NULL;
CREATE INDEX recommendation_cowatch_refresh_grant_time_idx ON recommendation_cowatch_refresh_grant (approved_at DESC);
CREATE FUNCTION guard_cowatch_refresh_grant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.approved_at + interval '2555 days' <= clock_timestamp() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
    AND NEW.revocation_reason IS NOT NULL
    AND (to_jsonb(NEW) - 'revoked_at' - 'revocation_reason') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'revoked_at' - 'revocation_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'co-watch refresh grant is immutable';
END $$;
CREATE TRIGGER cowatch_refresh_grant_immutable BEFORE UPDATE OR DELETE ON recommendation_cowatch_refresh_grant FOR EACH ROW EXECUTE FUNCTION guard_cowatch_refresh_grant();
CREATE TABLE recommendation_cowatch_refresh_attempt (
  id uuid PRIMARY KEY,
  grant_id uuid NOT NULL REFERENCES recommendation_cowatch_refresh_grant(id) ON DELETE RESTRICT,
  expected_pointer_generation integer NOT NULL CHECK (expected_pointer_generation > 0),
  window_start timestamp(3) NOT NULL,
  window_end timestamp(3) NOT NULL,
  evaluation_as_of timestamp(3) NOT NULL,
  started_at timestamp(3) NOT NULL,
  lease_until timestamp(3) NOT NULL,
  status varchar(32) NOT NULL CHECK (status IN ('running', 'succeeded', 'refused')),
  expected_graph_generation_id char(64),
  published_at timestamp(3),
  completed_at timestamp(3),
  reason varchar(64),
  pointer_generation integer,
  CHECK (window_end = window_start + interval '7 days' AND evaluation_as_of = window_end + interval '7 hours'),
  CHECK ((status = 'running' AND completed_at IS NULL) OR (status <> 'running' AND completed_at IS NOT NULL)),
  CHECK (status <> 'succeeded' OR (expected_graph_generation_id IS NOT NULL AND published_at IS NOT NULL AND pointer_generation = expected_pointer_generation + 1))
);
CREATE INDEX recommendation_cowatch_refresh_attempt_grant_idx ON recommendation_cowatch_refresh_attempt (grant_id, started_at DESC);
CREATE INDEX recommendation_cowatch_refresh_attempt_publication_idx ON recommendation_cowatch_refresh_attempt (published_at DESC);
CREATE UNIQUE INDEX recommendation_cowatch_refresh_one_running_attempt ON recommendation_cowatch_refresh_attempt ((true)) WHERE status = 'running';
CREATE FUNCTION guard_cowatch_refresh_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status <> 'running' AND OLD.started_at + interval '2555 days' <= clock_timestamp() THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' OR OLD.status <> 'running'
    OR (to_jsonb(NEW) - 'lease_until' - 'status' - 'expected_graph_generation_id' - 'published_at' - 'completed_at' - 'reason' - 'pointer_generation') IS DISTINCT FROM
      (to_jsonb(OLD) - 'lease_until' - 'status' - 'expected_graph_generation_id' - 'published_at' - 'completed_at' - 'reason' - 'pointer_generation')
    OR (OLD.expected_graph_generation_id IS NOT NULL AND NEW.expected_graph_generation_id IS DISTINCT FROM OLD.expected_graph_generation_id)
    OR (OLD.published_at IS NOT NULL AND NEW.published_at IS DISTINCT FROM OLD.published_at) THEN
    RAISE EXCEPTION 'co-watch refresh attempt identity and terminal receipt are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cowatch_refresh_attempt_immutable BEFORE UPDATE OR DELETE ON recommendation_cowatch_refresh_attempt FOR EACH ROW EXECUTE FUNCTION guard_cowatch_refresh_attempt();
COMMENT ON TABLE recommendation_cowatch_refresh_grant IS 'Fixed policy owner delegation; minimized operator audit retained for 2555 days, independent of graph and raw input retention.';
COMMENT ON TABLE recommendation_cowatch_refresh_attempt IS 'Immutable attempt scope and terminal receipt; minimized audit retained for 2555 days, without source identity payloads.';
COMMIT;
RESET lock_timeout;
RESET statement_timeout;

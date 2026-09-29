-- Dedicated metadata capabilities; no corpus or credential grants.
CREATE SCHEMA usage_private;
REVOKE ALL ON SCHEMA usage_private FROM PUBLIC;
CREATE TABLE usage_private.minutes (
  consumer_id uuid NOT NULL REFERENCES consumer_private.consumers(id),
  minute timestamptz NOT NULL,
  request_count bigint NOT NULL DEFAULT 0 CHECK(request_count >= 0),
  successful_count bigint NOT NULL DEFAULT 0 CHECK(successful_count >= 0 AND successful_count <= request_count),
  last_activity_at timestamptz NOT NULL,
  PRIMARY KEY(consumer_id, minute)
);
CREATE TABLE usage_private.collectors (
  id uuid PRIMARY KEY,
  started_at timestamptz NOT NULL,
  complete_through timestamptz NOT NULL,
  heartbeat_at timestamptz NOT NULL,
  stopped_at timestamptz,
  CHECK(complete_through >= started_at)
);
CREATE TABLE usage_private.pending (
  id uuid PRIMARY KEY,
  collector_id uuid NOT NULL REFERENCES usage_private.collectors(id),
  consumer_id uuid NOT NULL REFERENCES consumer_private.consumers(id),
  admitted_at timestamptz NOT NULL
);
CREATE INDEX usage_pending_time ON usage_private.pending(admitted_at);
CREATE TABLE usage_private.gaps (
  collector_id uuid NOT NULL REFERENCES usage_private.collectors(id),
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL CHECK(ended_at >= started_at),
  PRIMARY KEY(collector_id, started_at)
);
CREATE TABLE usage_private.denials (
  minute timestamptz NOT NULL,
  reason text NOT NULL CHECK(reason IN ('unauthorized','auth_unavailable','body_limit','legacy_unattributed')),
  request_count bigint NOT NULL CHECK(request_count >= 0),
  PRIMARY KEY(minute, reason)
);
CREATE VIEW usage_private.consumer_labels AS SELECT id AS consumer_id, name AS label FROM consumer_private.consumers;
CREATE VIEW usage_private.report_minutes AS SELECT * FROM usage_private.minutes;
CREATE VIEW usage_private.report_collectors AS SELECT * FROM usage_private.collectors;
CREATE VIEW usage_private.report_pending AS SELECT consumer_id, admitted_at FROM usage_private.pending;
CREATE VIEW usage_private.report_gaps AS SELECT started_at, ended_at FROM usage_private.gaps;
REVOKE ALL ON ALL TABLES IN SCHEMA usage_private FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA usage_private REVOKE ALL ON TABLES FROM PUBLIC;
